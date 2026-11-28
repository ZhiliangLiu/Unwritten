import asyncio

import pytest

from launcher.machine import InvalidState, Machine

NORMAL_SCRIPT = [
    'unwritten-host {"phase": "starting"}',
    "plain output that is not a status line",
    'unwritten-host {"phase": "serving"}',
    'unwritten-host {"phase": "exiting", "reason": "idle"}',
]


def commands(calls, name):
    return [entry for entry in calls() if len(entry["argv"]) > 1 and entry["argv"][1] == name]


async def test_normal_path(config, fake_colab, exec_script, wait_state, calls, wait_command):
    exec_script(NORMAL_SCRIPT)
    machine = Machine(config)
    snapshot = machine.start(30)
    assert snapshot["state"] == "starting"

    needs_action = await wait_state(machine, {"needs_action"})
    action = needs_action["action"]
    assert action["url"] == "https://accounts.google.com/o/oauth2/x"
    assert isinstance(action["expiresAt"], int)

    await machine.continue_()
    await wait_state(machine, {"running"})
    await wait_state(machine, {"stopped"})
    await wait_command("stop")
    assert len(commands(calls, "new")) == 1


async def test_second_start_does_not_create_another_session(config, fake_colab, exec_script, wait_state, calls):
    exec_script(['unwritten-host {"phase": "serving"}'], hold=True)
    machine = Machine(config)
    machine.start(30)
    await wait_state(machine, {"needs_action"})
    second = machine.start(30)
    assert second["state"] == "needs_action"
    await machine.continue_()
    await wait_state(machine, {"running"})
    assert len(commands(calls, "new")) == 1
    await machine.stop()


async def test_quota_failure_stops_runtime(config, fake_colab, monkeypatch, wait_state, calls, wait_command):
    monkeypatch.setenv("FAKE_COLAB_NEW", "400")
    machine = Machine(config)
    machine.start(30)
    failed = await wait_state(machine, {"failed"})
    assert failed["reason"] == "quota"
    await wait_command("stop")
    assert len(commands(calls, "stop")) >= 1


async def test_action_expires(config, fake_colab, exec_script, wait_state):
    release = asyncio.Event()

    class Clock:
        value = 1000.0

        def __call__(self):
            return self.value

    clock = Clock()

    async def hold(seconds):
        await release.wait()
        clock.value += 600

    exec_script(['unwritten-host {"phase": "serving"}'], hold=True)
    machine = Machine(config, clock=clock, sleep=hold)
    machine.start(30)
    needs_action = await wait_state(machine, {"needs_action"})
    assert needs_action["action"]["expiresAt"] == 1600
    release.set()
    failed = await wait_state(machine, {"failed"})
    assert failed["reason"] == "action_expired"


@pytest.mark.parametrize(
    "url",
    [
        "http://accounts.google.com/o/oauth2/x",
        "https://accounts.example.test/o/oauth2/x",
        "https://evil.test.google.com.example.test/o/oauth2/x",
    ],
)
async def test_invalid_action_url(config, fake_colab, monkeypatch, wait_state, url):
    monkeypatch.setenv("FAKE_COLAB_CONSENT_URL", url)
    machine = Machine(config)
    machine.start(30)
    failed = await wait_state(machine, {"failed"})
    assert failed["reason"] == "start_error"
    assert failed["action"] is None


async def test_continue_outside_needs_action_raises(config, fake_colab):
    machine = Machine(config)
    with pytest.raises(InvalidState):
        await machine.continue_()


async def test_stop_while_stopped_is_noop(config, fake_colab):
    machine = Machine(config)
    await machine.stop()
    assert machine.state == "stopped"
