import asyncio
import base64
import io
import secrets

from PIL import Image

from server.app import create_app
from server.config import RESULT_RETENTION_S


def png_reference(size=(8, 6)) -> dict:
    buffer = io.BytesIO()
    Image.new("RGB", size, (40, 50, 60)).save(buffer, "PNG")
    return {"mime": "image/png", "data": base64.b64encode(buffer.getvalue()).decode()}


def job_body(**overrides) -> dict:
    payload = {
        "idempotencyKey": secrets.token_hex(8),
        "prompt": "a quiet pier at dusk",
        "aspect": "3:2",
        "quality": "best",
    }
    payload.update(overrides)
    return payload


def auth(config) -> dict[str, str]:
    return {"Authorization": f"Bearer {config.token}"}


async def wait_status(client, config, job_id: str, expected: str) -> dict:
    for _ in range(500):
        response = await client.get(f"/v1/jobs/{job_id}", headers=auth(config))
        assert response.status == 200
        payload = await response.json()
        if payload["status"] == expected:
            return payload
        await asyncio.sleep(0.01)
    raise AssertionError(f"job did not reach {expected}")


async def test_request_level_errors(aiohttp_client, manifest, make_config, fake_comfy):
    _, url = fake_comfy
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))

    async def submit(payload):
        return await client.post("/v1/jobs", headers=auth(config), json=payload)

    response = await submit({"idempotencyKey": "missing-prompt", "aspect": "3:2", "quality": "best"})
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "invalid_request"

    references = [png_reference() for _ in range(11)]
    response = await submit(job_body(references=references))
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "too_many_references"

    oversized = base64.b64encode(b"\0" * (manifest.max_reference_bytes + 1)).decode()
    response = await submit(job_body(references=[{"mime": "image/png", "data": oversized}]))
    assert response.status == 413
    assert (await response.json())["error"]["code"] == "reference_too_large"

    response = await submit(job_body(aspect="7:5"))
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "unsupported_aspect"

    response = await submit(job_body(quality="draft"))
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "unsupported_quality"

    response = await submit(job_body(size={"width": 1200, "height": 720}))
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "unsupported_size"

    response = await submit(job_body(references=[{"mime": "image/png", "data": "not-base64"}]))
    assert response.status == 400
    assert (await response.json())["error"]["code"] == "invalid_request"


async def test_idempotency(aiohttp_client, manifest, make_config, fake_comfy):
    _, url = fake_comfy
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    payload = job_body()
    first = await client.post("/v1/jobs", headers=auth(config), json=payload)
    second = await client.post("/v1/jobs", headers=auth(config), json=payload)
    assert first.status == 202
    assert second.status == 202
    assert (await first.json())["id"] == (await second.json())["id"]

    conflict = await client.post("/v1/jobs", headers=auth(config), json={**payload, "prompt": "a different pier"})
    assert conflict.status == 409
    assert (await conflict.json())["error"]["code"] == "idempotency_conflict"


async def test_queue_full_returns_busy(aiohttp_client, manifest, make_config, fake_comfy):
    _, url = fake_comfy
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False, start_worker=False))
    for _ in range(manifest.queue_max):
        response = await client.post("/v1/jobs", headers=auth(config), json=job_body())
        assert response.status == 202
    response = await client.post("/v1/jobs", headers=auth(config), json=job_body())
    assert response.status == 429
    assert response.headers["Retry-After"] == "5"
    assert (await response.json())["error"]["code"] == "busy"


async def test_unsupported_size_never_reaches_comfy(aiohttp_client, manifest, make_config, fake_comfy):
    fake, url = fake_comfy
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    response = await client.post(
        "/v1/jobs",
        headers=auth(config),
        json=job_body(size={"width": 1200, "height": 720}),
    )
    assert response.status == 400
    await asyncio.sleep(0.05)
    assert fake.received == []

    accepted = await client.post(
        "/v1/jobs",
        headers=auth(config),
        json=job_body(size={"width": 1088, "height": 720}),
    )
    assert accepted.status == 202
    for _ in range(500):
        if fake.received:
            break
        await asyncio.sleep(0.01)
    assert len(fake.received) == 1


async def test_completed_image_is_webp_and_can_be_released(aiohttp_client, manifest, make_config, fake_comfy):
    fake, url = fake_comfy
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    response = await client.post(
        "/v1/jobs",
        headers=auth(config),
        json=job_body(size={"width": 1088, "height": 720}),
    )
    assert response.status == 202
    job_id = (await response.json())["id"]
    status = await wait_status(client, config, job_id, "done")
    assert status["seed"] is not None
    assert (status["width"], status["height"]) == (1088, 720)

    image = await client.get(f"/v1/jobs/{job_id}/image", headers=auth(config))
    assert image.status == 200
    assert image.content_type == "image/webp"
    data = await image.read()
    assert data[:4] == b"RIFF"
    with Image.open(io.BytesIO(data)) as opened:
        assert opened.format == "WEBP"
        assert opened.size == (1088, 720)

    deleted = await client.delete(f"/v1/jobs/{job_id}", headers=auth(config))
    assert deleted.status == 204
    missing = await client.get(f"/v1/jobs/{job_id}/image", headers=auth(config))
    assert missing.status == 404
    assert (await missing.json())["error"]["code"] == "not_found"

    assert not list(config.input_dir.glob(f"unwritten-{job_id}-*"))
    assert not list(fake.output_dir.iterdir())


async def test_completed_image_expires(aiohttp_client, manifest, make_config, fake_comfy):
    _, url = fake_comfy
    now = [1000.0]
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False, clock=lambda: now[0]))
    response = await client.post("/v1/jobs", headers=auth(config), json=job_body())
    job_id = (await response.json())["id"]
    await wait_status(client, config, job_id, "done")
    now[0] += RESULT_RETENTION_S + 1
    expired = await client.get(f"/v1/jobs/{job_id}/image", headers=auth(config))
    assert expired.status == 404


async def test_out_of_memory_is_mapped(aiohttp_client, manifest, make_config, fake_comfy):
    fake, url = fake_comfy
    fake.execution_error = "CUDA out of memory"
    config = make_config(url)
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    response = await client.post("/v1/jobs", headers=auth(config), json=job_body())
    job_id = (await response.json())["id"]
    status = await wait_status(client, config, job_id, "failed")
    assert status["error"]["code"] == "out_of_memory"
