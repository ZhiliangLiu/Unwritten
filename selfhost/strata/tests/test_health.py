import json
import socket

from conftest import make_config

from gateway import health
from gateway.state_file import GatewayState


def closed_port_url() -> str:
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return f"http://127.0.0.1:{port}"


async def test_unreachable_engine_marks_engine_down(tmp_path):
    config = make_config(closed_port_url(), state_path=tmp_path / "state.json")
    state = GatewayState(config.state_path)
    state.write()
    healthy = await health.check_once(config, state)
    assert healthy is False
    assert state.ready is False
    assert state.reason == "engine_down"
    status = json.loads(config.state_path.read_text(encoding="utf-8"))
    assert status["notReadyReason"] == "engine_down"


async def test_health_recovers_to_ready_after_selftest(fake_strata, tmp_path):
    config = make_config(fake_strata.url, state_path=tmp_path / "state.json")
    state = GatewayState(config.state_path)
    state.write()
    fake_strata.health_status = 500
    assert await health.check_once(config, state) is False
    assert state.reason == "engine_down"

    fake_strata.health_status = 200
    state.selftest_passed = True
    assert await health.check_once(config, state) is True
    assert state.ready is True
    assert state.reason is None
    status = json.loads(config.state_path.read_text(encoding="utf-8"))
    assert status["ready"] is True
    assert status["notReadyReason"] is None


async def test_health_returns_to_starting_before_selftest_passes(fake_strata, tmp_path):
    config = make_config(fake_strata.url, state_path=tmp_path / "state.json")
    state = GatewayState(config.state_path)
    state.write()
    fake_strata.health_status = 500
    await health.check_once(config, state)
    assert state.reason == "engine_down"
    fake_strata.health_status = 200
    await health.check_once(config, state)
    assert state.ready is False
    assert state.reason == "starting"


async def test_health_keeps_a_finished_selftest_failure(fake_strata, tmp_path):
    config = make_config(fake_strata.url, state_path=tmp_path / "state.json")
    state = GatewayState(config.state_path)
    state.mark_selftest_failed("load_timeout")
    fake_strata.health_status = 200
    await health.check_once(config, state)
    assert state.ready is False
    assert state.reason == "load_timeout"


def test_selftest_failure_does_not_override_engine_down(tmp_path):
    state = GatewayState(tmp_path / "state.json")
    state.set_unready("engine_down")
    state.mark_selftest_failed("load_timeout")
    assert state.reason == "engine_down"
    assert state.failure_reason == "load_timeout"
