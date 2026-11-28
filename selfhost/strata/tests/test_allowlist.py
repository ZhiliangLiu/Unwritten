import aiohttp
import pytest


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/health"),
        ("GET", "/settings"),
        ("GET", "/config"),
        ("GET", "/load"),
        ("GET", "/mcp"),
        ("GET", "/v1/messages"),
        ("GET", "/"),
        ("PUT", "/v1/models"),
        ("POST", "/v1/models"),
        ("HEAD", "/v1/models"),
        ("GET", "/v1/chat/completions"),
    ],
)
async def test_only_two_routes_reach_strata(gateway_server, fake_strata, auth_headers, method, path):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    async with aiohttp.ClientSession() as session:
        rejected = await session.request(method, gateway.url + path, headers=auth_headers)
        assert rejected.status == 404
        await rejected.read()
        assert fake_strata.requests == []
        accepted = await session.get(f"{gateway.url}/v1/models", headers=auth_headers)
        assert accepted.status == 200
        await accepted.read()
    assert [request.path for request in fake_strata.requests] == ["/v1/models"]
