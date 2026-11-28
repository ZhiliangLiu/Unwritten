from launcher import cli
from launcher.machine import Machine


async def test_continue_writes_newline_to_drivemount(fake_colab):
    handle = await cli.drivemount("unwritten-comfyui")
    url = await handle.read_url()
    assert url == "https://accounts.google.com/o/oauth2/x"
    await handle.continue_()
    assert await handle.wait() == 0
    assert (fake_colab / "drivemount.stdin").read_text() == "\n"


async def test_drivemount_without_consent_returns_no_url(fake_colab, monkeypatch):
    monkeypatch.setenv("FAKE_COLAB_CONSENT", "0")
    handle = await cli.drivemount("unwritten-comfyui")
    assert await handle.read_url() is None
    assert await handle.wait() == 0


async def test_start_skips_needs_action_without_url(config, fake_colab, exec_script, wait_state, monkeypatch):
    monkeypatch.setenv("FAKE_COLAB_CONSENT", "0")
    exec_script(['unwritten-host {"phase": "serving"}'], hold=True)
    machine = Machine(config)
    machine.start(30)
    snapshot = await wait_state(machine, {"running"})
    assert snapshot["action"] is None
    await machine.stop()
