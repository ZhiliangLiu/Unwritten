import asyncio
import json

import aiohttp

from gateway import forward

CHAT = "/v1/chat/completions"


async def test_internal_key_replaces_caller_token_and_filters_headers(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    payload = {"messages": [{"role": "user", "content": "hello"}]}
    async with aiohttp.ClientSession() as session:
        response = await session.post(
            gateway.url + CHAT,
            json=payload,
            headers={**auth_headers, "X-Custom": "keep-out"},
        )
        assert response.status == 200
        await response.read()
    record = fake_strata.requests[-1]
    assert record.headers.get("Authorization") == f"Bearer {gateway.config.internal_key}"
    assert "X-Custom" not in record.headers
    assert gateway.config.token not in json.dumps(record.headers)


async def test_cors_headers_are_removed(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    async with aiohttp.ClientSession() as session:
        direct = await session.get(f"{fake_strata.url}/v1/models")
        assert direct.headers.get("Access-Control-Allow-Origin") == "*"
        await direct.read()
        response = await session.get(f"{gateway.url}/v1/models", headers=auth_headers)
        assert response.status == 200
        assert not any(name.lower().startswith("access-control-") for name in response.headers)
        await response.read()


async def test_redirect_is_reported_as_502(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    fake_strata.redirect = True
    payload = {"messages": [{"role": "user", "content": "hello"}]}
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 502
        assert "Location" not in response.headers
        error = await response.json()
    assert error["error"]["code"] == "upstream_redirected"
    assert fake_strata.requests[-1].path == CHAT


async def test_first_chunk_arrives_before_upstream_finishes(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    fake_strata.stream_gate = asyncio.Event()
    payload = {"messages": [{"role": "user", "content": "hello"}], "stream": True}
    async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=5)) as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        try:
            first = await asyncio.wait_for(response.content.readany(), timeout=1.0)
            assert b"data:" in first
            assert not fake_strata.stream_gate.is_set()
            state = json.loads(gateway.config.state_path.read_text(encoding="utf-8"))
            assert state["inFlight"] == 1
        finally:
            fake_strata.stream_gate.set()
        rest = await asyncio.wait_for(response.content.read(), timeout=1.0)
        assert b"[DONE]" in rest
    for _ in range(20):
        state = json.loads(gateway.config.state_path.read_text(encoding="utf-8"))
        if state["inFlight"] == 0:
            break
        await asyncio.sleep(0.01)
    assert state["inFlight"] == 0
    assert state["lastActivityAt"] is not None


async def test_upstream_total_timeout_is_disabled(gateway_server, fake_strata, auth_headers, monkeypatch):
    real_timeout = aiohttp.ClientTimeout
    real_aiohttp = aiohttp

    class ShortDefaultTimeout(real_timeout):
        def __init__(self, total=0.2, **kwargs):
            super().__init__(total=total, **kwargs)

    class Proxy:
        ClientTimeout = ShortDefaultTimeout

        def __getattr__(self, name):
            return getattr(real_aiohttp, name)

    monkeypatch.setattr(forward, "aiohttp", Proxy())
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    fake_strata.stream_pause = 0.5
    payload = {"messages": [{"role": "user", "content": "hello"}], "stream": True}
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 200
        body = await asyncio.wait_for(response.read(), timeout=2.0)
    assert b"[DONE]" in body
