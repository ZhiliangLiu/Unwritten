import secrets
from pathlib import Path
from typing import Any

import pytest
from fake_comfy import create_fake_app

from server.config import Config
from server.manifest import Manifest

TEST_WORKFLOWS = Path(__file__).resolve().parent / "workflows"
TEST_GPU = "Fake GPU 24GB"


@pytest.fixture
def manifest() -> Manifest:
    return Manifest.load(TEST_WORKFLOWS, gpu_name=TEST_GPU)


@pytest.fixture
def make_config(tmp_path: Path):
    def make(comfy_url: str, *, state_file: Path | None = None, gpu_name: str | None = TEST_GPU) -> Config:
        input_dir = tmp_path / "comfy-input"
        output_dir = tmp_path / "comfy-output"
        input_dir.mkdir(exist_ok=True)
        output_dir.mkdir(exist_ok=True)
        return Config(
            token=secrets.token_urlsafe(32),
            port=0,
            comfy_url=comfy_url,
            input_dir=input_dir,
            output_dir=output_dir,
            gpu_name=gpu_name,
            state_file=state_file if state_file is not None else tmp_path / "state.json",
        )

    return make


@pytest.fixture
async def fake_comfy(tmp_path: Path, aiohttp_server: Any):
    app, fake = create_fake_app(tmp_path / "comfy-output")
    server = await aiohttp_server(app)
    return fake, str(server.make_url("")).rstrip("/")
