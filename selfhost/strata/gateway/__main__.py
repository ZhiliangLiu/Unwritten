import asyncio
import logging

from aiohttp import web

from . import health, selftest
from .app import create_app
from .config import load
from .state_file import GatewayState


async def serve() -> None:
    config = load()
    state = GatewayState(config.state_path)
    state.write()
    app = create_app(config, state)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", config.port)
    await site.start()
    tasks = [
        asyncio.create_task(selftest.run(config, state)),
        asyncio.create_task(health.run(config, state)),
    ]
    try:
        await asyncio.Event().wait()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await runner.cleanup()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        asyncio.run(serve())
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
