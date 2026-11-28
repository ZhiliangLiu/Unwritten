import asyncio
import logging

import aiohttp

from .config import Config
from .state_file import GatewayState

logger = logging.getLogger("gateway")

HEALTH_TIMEOUT_S = 10.0


async def check_once(config: Config, state: GatewayState) -> bool:
    healthy = False
    timeout = aiohttp.ClientTimeout(total=HEALTH_TIMEOUT_S, sock_connect=5)
    try:
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(config.strata_url + "/health", allow_redirects=False) as response:
                healthy = 200 <= response.status < 300
                await response.read()
    except (aiohttp.ClientError, TimeoutError, OSError):
        healthy = False

    before = (state.ready, state.reason)
    if not healthy:
        state.set_unready("engine_down")
    elif state.selftest_passed:
        state.set_ready(True, None)
    elif state.selftest_finished:
        state.set_unready(state.failure_reason or "starting")
    else:
        state.set_unready("starting")
    if (state.ready, state.reason) != before:
        logger.info("health: %s", "ready" if state.ready else state.reason)
    return healthy


async def run(config: Config, state: GatewayState, *, interval_s: float | None = None) -> None:
    interval = config.health_interval_s if interval_s is None else interval_s
    while True:
        await check_once(config, state)
        await asyncio.sleep(interval)
