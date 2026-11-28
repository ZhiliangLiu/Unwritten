import asyncio
import json
from pathlib import Path

import pytest

from launcher.app import create_app
from launcher.config import Config, ServiceConfig

LAUNCHER_DIR = Path(__file__).resolve().parents[1]
LAUNCHER_TOKEN = "test-launcher-token-0123456789abcdef"
IMAGE_TOKEN = "test-image-token-0123456789abcdef"
AUTH_KEY = "test-auth-key-0123456789abcdef"


@pytest.fixture
def project_tree(tmp_path):
    host = tmp_path / "host"
    (host / "unwritten_colab").mkdir(parents=True)
    (host / "unwritten_colab" / "__init__.py").write_text("")
    (host / "tests").mkdir()
    (host / "tests" / "test_host.py").write_text("")
    (host / ".venv").mkdir()
    (host / ".venv" / "marker.py").write_text("")
    (host / "notebook.ipynb").write_text("{}")
    code = tmp_path / "comfyui"
    (code / "server").mkdir(parents=True)
    (code / "colab_service.py").write_text("")
    (code / "tests").mkdir()
    (code / "tests" / "test_service.py").write_text("")
    (code / "colab.ipynb").write_text("{}")
    return host, code


@pytest.fixture
def config(project_tree):
    host, code = project_tree
    return Config(
        port=0,
        listen="127.0.0.1",
        token=LAUNCHER_TOKEN,
        host_dir=host,
        service=ServiceConfig(
            name="comfyui",
            code=code,
            session="unwritten-comfyui",
            gpu="A100",
            high_mem=False,
            token=IMAGE_TOKEN,
            tailscale_auth_key=AUTH_KEY,
        ),
        problem=None,
    )


@pytest.fixture
def fake_colab(tmp_path, monkeypatch):
    state = tmp_path / "fake-colab"
    state.mkdir()
    monkeypatch.setenv("FAKE_COLAB_DIR", str(state))
    monkeypatch.setenv("UNWRITTEN_COLAB_BIN", str(LAUNCHER_DIR / "tests" / "fake_colab.py"))
    return state


@pytest.fixture
def write_config(tmp_path):
    def write(*, mode=0o600, service=None, **overrides):
        data = {
            "port": 8290,
            "listen": "127.0.0.1",
            "token": LAUNCHER_TOKEN,
            "host": str(tmp_path / "host"),
            "service": {
                "name": "comfyui",
                "code": str(tmp_path / "comfyui"),
                "session": "unwritten-comfyui",
                "gpu": "A100",
                "highMem": False,
                "token": IMAGE_TOKEN,
                "tailscaleAuthKey": AUTH_KEY,
            },
        }
        data["service"].update(service or {})
        data.update(overrides)
        path = tmp_path / "colab-launcher.json"
        path.write_text(json.dumps(data))
        path.chmod(mode)
        return path

    return write


@pytest.fixture
def auth_headers():
    def headers(token=LAUNCHER_TOKEN):
        return {"Authorization": f"Bearer {token}"}

    return headers


@pytest.fixture
async def launcher_client(config, fake_colab, aiohttp_client):
    return await aiohttp_client(create_app(config))


@pytest.fixture
def exec_script(fake_colab, monkeypatch):
    def write(lines, *, hold=False, delay=0.15):
        path = fake_colab / "exec.txt"
        path.write_text("\n".join(lines) + "\n")
        monkeypatch.setenv("FAKE_COLAB_EXEC_SCRIPT", str(path))
        monkeypatch.setenv("FAKE_COLAB_EXEC_DELAY", str(delay))
        monkeypatch.setenv("FAKE_COLAB_EXEC_HOLD", "1" if hold else "0")
        return path

    return write


@pytest.fixture
def calls(fake_colab):
    def read():
        path = fake_colab / "calls.log"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines()]

    return read


@pytest.fixture
def wait_command(calls):
    async def wait(name, timeout=5):
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            if any(len(entry["argv"]) > 1 and entry["argv"][1] == name for entry in calls()):
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"colab {name} was not called")

    return wait


@pytest.fixture
def wait_state():
    async def wait(machine, states, timeout=15):
        expected = set(states)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            if machine.state in expected:
                return machine.snapshot()
            await asyncio.sleep(0.01)
        raise AssertionError(f"machine state is {machine.state}, expected {expected}")

    return wait


@pytest.fixture
def wait_http_state():
    async def wait(client, headers, states, timeout=15):
        expected = set(states)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + timeout
        while loop.time() < deadline:
            response = await client.get("/v1/state", headers=headers)
            body = await response.json()
            if body["state"] in expected:
                return body
            await asyncio.sleep(0.01)
        raise AssertionError(f"launcher state did not reach {expected}")

    return wait
