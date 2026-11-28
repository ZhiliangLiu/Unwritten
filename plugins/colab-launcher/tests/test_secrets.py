import json
import logging
from dataclasses import replace

from launcher.machine import Machine

SERVING_SCRIPT = [
    'unwritten-host {"phase": "serving"}',
    'unwritten-host {"phase": "exiting", "reason": "idle"}',
]


async def test_secrets_only_travel_in_the_uploaded_launch_file(config, fake_colab, exec_script, wait_state, caplog):
    caplog.set_level(logging.INFO)
    launcher_token = "launcher-SECRET-0123456789abcdef0123456789"
    service_token = "image-SECRET-0123456789abcdef0123456789"
    auth_key = "tailscale-SECRET-0123456789abcdef0123456789"
    custom = replace(
        config,
        token=launcher_token,
        service=replace(config.service, token=service_token, tailscale_auth_key=auth_key),
    )
    exec_script(SERVING_SCRIPT)
    machine = Machine(custom)
    machine.start(30)
    await wait_state(machine, {"needs_action"})
    await machine.continue_()
    await wait_state(machine, {"running"})
    await wait_state(machine, {"stopped"})

    calls_log = (fake_colab / "calls.log").read_text()
    assert service_token not in calls_log
    assert auth_key not in calls_log
    assert launcher_token not in calls_log

    assert service_token not in caplog.text
    assert auth_key not in caplog.text
    assert launcher_token not in caplog.text
    assert "state needs_action" in caplog.text

    uploaded = json.loads((fake_colab / "runtime" / "content" / "unwritten" / "launch.json").read_text())
    assert uploaded["token"] == service_token
    assert uploaded["tailscaleAuthKey"] == auth_key
