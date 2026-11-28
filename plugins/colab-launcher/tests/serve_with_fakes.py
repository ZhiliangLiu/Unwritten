import asyncio
import json
import os
import secrets
import signal
import socket
import sys
import tempfile
from pathlib import Path

from aiohttp import web

REPO = Path(__file__).resolve().parents[3]
TESTS = Path(__file__).resolve().parent

sys.path.insert(0, str(TESTS.parent))

from launcher.app import create_app
from launcher.config import load_config


def prepare() -> str:
    work = Path(tempfile.mkdtemp(prefix="unwritten-launcher-conformance-"))
    fake = work / "fake-colab"
    fake.mkdir()
    script = work / "exec.txt"
    script.write_text('unwritten-host {"phase": "starting"}\nunwritten-host {"phase": "serving"}\n')
    token = secrets.token_urlsafe(32)
    config = {
        "port": 0,
        "listen": "127.0.0.1",
        "token": token,
        "host": str(REPO / "selfhost" / "colab"),
        "service": {
            "name": "comfyui",
            "code": str(REPO / "plugins" / "comfyui"),
            "session": "unwritten-comfyui",
            "gpu": "A100",
            "highMem": False,
            "token": secrets.token_urlsafe(32),
            "tailscaleAuthKey": secrets.token_urlsafe(32),
        },
    }
    path = work / "colab-launcher.json"
    path.write_text(json.dumps(config))
    path.chmod(0o600)
    os.environ["UNWRITTEN_LAUNCHER_CONFIG"] = str(path)
    os.environ["UNWRITTEN_COLAB_BIN"] = str(TESTS / "fake_colab.py")
    os.environ["FAKE_COLAB_DIR"] = str(fake)
    os.environ["FAKE_COLAB_CONSENT"] = "1"
    os.environ["FAKE_COLAB_EXEC_SCRIPT"] = str(script)
    os.environ["FAKE_COLAB_EXEC_HOLD"] = "1"
    os.environ["FAKE_COLAB_EXEC_DELAY"] = "0.05"
    return token


async def serve(token: str) -> None:
    app = create_app(load_config())
    runner = web.AppRunner(app)
    await runner.setup()
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    sock.listen(128)
    sock.setblocking(False)
    site = web.SockSite(runner, sock)
    await site.start()
    port = sock.getsockname()[1]
    print(f"UNWRITTEN_CONFORMANCE_URL=http://127.0.0.1:{port}", flush=True)
    print(f"UNWRITTEN_CONFORMANCE_TOKEN={token}", flush=True)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)
    await stop.wait()
    await runner.cleanup()


def main() -> None:
    token = prepare()
    asyncio.run(serve(token))


main()
