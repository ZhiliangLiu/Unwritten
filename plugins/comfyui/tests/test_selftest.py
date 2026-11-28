import asyncio
import json
import shutil
from pathlib import Path

from server.app import create_app
from server.manifest import Manifest

WORKFLOWS = Path(__file__).resolve().parent / "workflows"
TEST_GPU = "Fake GPU 24GB"


def auth(config) -> dict[str, str]:
    return {"Authorization": f"Bearer {config.token}"}


async def read_info(client, config) -> dict:
    response = await client.get("/v1/info", headers=auth(config))
    assert response.status == 200
    return await response.json()


async def wait_ready(client, config, expected: bool, reason: str | None = None) -> dict:
    for _ in range(2000):
        info = await read_info(client, config)
        if info["ready"] == expected and (reason is None or info["notReadyReason"] == reason):
            return info
        await asyncio.sleep(0.01)
    raise AssertionError("selftest did not finish in time")


async def test_selftest_runs_all_four_templates(aiohttp_client, manifest, make_config, fake_comfy):
    fake, url = fake_comfy
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest))
    info = await wait_ready(client, config, True)
    assert info["notReadyReason"] is None
    assert len(fake.received) == 4


async def test_selftest_failure_keeps_info_readable(aiohttp_client, tmp_path, make_config, fake_comfy):
    _, url = fake_comfy
    directory = tmp_path / "workflows"
    shutil.copytree(WORKFLOWS, directory)
    data = json.loads((directory / "manifest.json").read_text())
    data["templates"]["t2i-best"]["width"] = ["1", "w"]
    (directory / "manifest.json").write_text(json.dumps(data))
    broken = Manifest.load(directory, gpu_name=TEST_GPU)
    config = make_config(url)
    client = await aiohttp_client(create_app(config, broken))
    info = await wait_ready(client, config, False, "workflow_error")
    assert info["protocol"] == "unwritten-image/1"
