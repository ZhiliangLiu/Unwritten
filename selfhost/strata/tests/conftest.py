import sys
from dataclasses import dataclass
from pathlib import Path

import pytest
from aiohttp import web
from fake_strata import FakeStrata

from gateway.app import create_app
from gateway.config import Config
from gateway.state_file import GatewayState

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "colab"))

CALLER_HEADER = "test-token-0123456789abcdef0123456789abcdef"
INTERNAL_KEY = "internal-key-0123456789abcdef0123456789abcdef"


def make_config(
    strata_url: str,
    *,
    state_path: Path,
    max_body_bytes: int = 1024 * 1024,
    health_interval_s: float = 0.1,
    load_timeout_s: float = 1.0,
) -> Config:
    return Config(
        token=CALLER_HEADER,
        internal_key=INTERNAL_KEY,
        port=0,
        strata_url=strata_url,
        max_body_bytes=max_body_bytes,
        health_interval_s=health_interval_s,
        load_timeout_s=load_timeout_s,
        state_path=state_path,
    )


@dataclass
class RunningGateway:
    url: str
    config: Config
    state: GatewayState


@pytest.fixture
async def fake_strata():
    fake = FakeStrata()
    runner = web.AppRunner(fake.app(), access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", 0)
    await site.start()
    fake.url = f"http://127.0.0.1:{runner.addresses[0][1]}"
    yield fake
    await runner.cleanup()


@pytest.fixture
async def gateway_server(fake_strata: FakeStrata, tmp_path: Path):
    runners: list[web.AppRunner] = []

    async def start(**overrides) -> RunningGateway:
        state_path = tmp_path / f"state-{len(runners)}.json"
        config = make_config(fake_strata.url, state_path=state_path, **overrides)
        state = GatewayState(config.state_path)
        state.write()
        runner = web.AppRunner(create_app(config, state), access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, "127.0.0.1", 0)
        await site.start()
        runners.append(runner)
        return RunningGateway(f"http://127.0.0.1:{runner.addresses[0][1]}", config, state)

    yield start
    for runner in runners:
        await runner.cleanup()


@pytest.fixture
def auth_headers() -> dict[str, str]:
    return {"Authorization": f"Bearer {CALLER_HEADER}"}
