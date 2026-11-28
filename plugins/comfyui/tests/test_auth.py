import pytest

from server.app import create_app
from server.config import load_config

SHORT_VALUE = "short-secret-value-0123456789"


async def test_missing_token_is_unauthorized(aiohttp_client, manifest, make_config):
    config = make_config("http://127.0.0.1:1")
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    response = await client.get("/v1/info")
    assert response.status == 401
    assert (await response.json())["error"] == {"code": "unauthorized", "message": "unauthorized"}


async def test_wrong_token_is_unauthorized(aiohttp_client, manifest, make_config):
    config = make_config("http://127.0.0.1:1")
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    response = await client.get("/v1/info", headers={"Authorization": f"Bearer {config.token}x"})
    assert response.status == 401
    assert (await response.json())["error"]["code"] == "unauthorized"


async def test_responses_have_no_cors_headers(aiohttp_client, manifest, make_config):
    config = make_config("http://127.0.0.1:1")
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    responses = [
        await client.get("/v1/info", headers={"Authorization": f"Bearer {config.token}"}),
        await client.get("/v1/jobs/missing", headers={"Authorization": f"Bearer {config.token}"}),
        await client.post(
            "/v1/jobs",
            headers={"Authorization": f"Bearer {config.token}"},
            json={"idempotencyKey": "cors", "aspect": "3:2", "quality": "best"},
        ),
        await client.get("/v1/info"),
    ]
    for response in responses:
        assert not [name for name in response.headers if name.lower().startswith("access-control-")]


def test_short_token_exits_without_printing_it(capsys):
    with pytest.raises(SystemExit):
        load_config({"UNWRITTEN_IMAGE_TOKEN": SHORT_VALUE})
    captured = capsys.readouterr()
    assert "token too short" in captured.err
    assert SHORT_VALUE not in captured.err
    assert SHORT_VALUE not in captured.out


async def test_token_must_be_present(aiohttp_client, manifest, make_config):
    config = make_config("http://127.0.0.1:1")
    client = await aiohttp_client(create_app(config, manifest, run_selftest=False))
    response = await client.get("/v1/info", headers={"Authorization": "Bearer "})
    assert response.status == 401
    assert response.content_type == "application/json"
