import asyncio
import secrets
import signal
import sys
import tempfile
from pathlib import Path

import aiohttp
from aiohttp import web

PLUGIN_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PLUGIN_ROOT))

from fake_comfy import create_fake_app

from server.app import create_app
from server.config import Config
from server.manifest import Manifest

WORKFLOWS = Path(__file__).resolve().parent / "workflows"
TEST_GPU = "Fake GPU 24GB"


async def _serve(app: web.Application, port: int) -> web.AppRunner:
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "127.0.0.1", port)
    await site.start()
    return runner


async def main() -> int:
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        input_dir = root / "input"
        output_dir = root / "output"
        input_dir.mkdir()
        output_dir.mkdir()
        fake_app, _ = create_fake_app(output_dir)
        fake_runner = await _serve(fake_app, 0)
        fake_port = fake_runner.addresses[0][1]
        token = secrets.token_urlsafe(32)
        config = Config(
            token=token,
            port=0,
            comfy_url=f"http://127.0.0.1:{fake_port}",
            input_dir=input_dir,
            output_dir=output_dir,
            gpu_name=TEST_GPU,
            state_file=root / "state.json",
        )
        manifest = Manifest.load(WORKFLOWS, gpu_name=TEST_GPU)
        wrapper_runner = await _serve(create_app(config, manifest), 0)
        port = wrapper_runner.addresses[0][1]
        stop = asyncio.Event()
        loop = asyncio.get_running_loop()
        for name in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(name, stop.set)
        try:
            async with aiohttp.ClientSession() as session:
                deadline = loop.time() + 120
                while True:
                    try:
                        async with session.get(
                            f"http://127.0.0.1:{port}/v1/info",
                            headers={"Authorization": f"Bearer {token}"},
                        ) as response:
                            payload = await response.json()
                            if response.status == 200 and payload.get("ready"):
                                break
                    except aiohttp.ClientError:
                        pass
                    if loop.time() > deadline:
                        print("selftest did not finish", file=sys.stderr, flush=True)
                        return 1
                    await asyncio.sleep(0.1)
            print(f"UNWRITTEN_CONFORMANCE_URL=http://127.0.0.1:{port}", flush=True)
            print(f"UNWRITTEN_CONFORMANCE_TOKEN={token}", flush=True)
            await stop.wait()
        finally:
            await wrapper_runner.cleanup()
            await fake_runner.cleanup()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
