import json

from conftest import make_config

from gateway import selftest
from gateway.state_file import GatewayState


class FakeClock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        return self.now

    async def sleep(self, seconds: float) -> None:
        self.now += seconds


async def test_selftest_retries_until_a_valid_ping(fake_strata, tmp_path):
    fake_strata.loading_remaining = 3
    config = make_config(fake_strata.url, state_path=tmp_path / "state.json")
    state = GatewayState(config.state_path)
    state.write()
    clock = FakeClock()
    passed = await selftest.run(config, state, clock=clock, sleep=clock.sleep)
    assert passed is True
    assert state.ready is True
    assert state.reason is None
    status = json.loads(config.state_path.read_text(encoding="utf-8"))
    assert status == {"ready": True, "notReadyReason": None, "inFlight": 0, "lastActivityAt": None}
    chats = [request for request in fake_strata.requests if request.path == "/v1/chat/completions"]
    assert len(chats) == 4
    body = json.loads(chats[-1].body)
    assert body["messages"] == [{"role": "user", "content": "Call the ping tool with the word ok."}]
    assert body["stream"] is True
    assert body["reasoning_effort"] == "none"
    assert body["tools"][0]["function"]["name"] == "ping"
    assert body["tool_choice"]["function"]["name"] == "ping"


async def test_selftest_reports_self_test_failed_when_the_model_does_not_call_the_tool(fake_strata, tmp_path):
    fake_strata.tool_call = False
    config = make_config(
        fake_strata.url,
        state_path=tmp_path / "state.json",
        health_interval_s=0.1,
        load_timeout_s=0.35,
    )
    state = GatewayState(config.state_path)
    state.write()
    clock = FakeClock()
    passed = await selftest.run(config, state, clock=clock, sleep=clock.sleep)
    assert passed is False
    assert state.ready is False
    assert state.reason == "self_test_failed"
    status = json.loads(config.state_path.read_text(encoding="utf-8"))
    assert status["notReadyReason"] == "self_test_failed"


async def test_selftest_reports_load_timeout_when_the_model_never_answers(fake_strata, tmp_path):
    fake_strata.loading_remaining = 10**6
    config = make_config(
        fake_strata.url,
        state_path=tmp_path / "state.json",
        health_interval_s=0.1,
        load_timeout_s=0.35,
    )
    state = GatewayState(config.state_path)
    state.write()
    clock = FakeClock()
    passed = await selftest.run(config, state, clock=clock, sleep=clock.sleep)
    assert passed is False
    assert state.ready is False
    assert state.reason == "load_timeout"
    status = json.loads(config.state_path.read_text(encoding="utf-8"))
    assert status["notReadyReason"] == "load_timeout"
