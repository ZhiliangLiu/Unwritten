import json

import aiohttp
import pytest

CHAT = "/v1/chat/completions"


async def test_body_over_limit_is_rejected_before_upstream(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server(max_body_bytes=1024)
    gateway.state.set_ready(True, None)
    payload = {"messages": [{"role": "user", "content": "x" * 4096}]}
    async with aiohttp.ClientSession() as session:
        response = await session.post(
            gateway.url + CHAT,
            data=json.dumps(payload),
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        assert response.status == 413
        await response.read()
    assert fake_strata.requests == []


@pytest.mark.parametrize("body", [b"[]", b'"text"', b"not json", b""])
async def test_body_must_be_a_json_object(gateway_server, fake_strata, auth_headers, body):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    async with aiohttp.ClientSession() as session:
        response = await session.post(
            gateway.url + CHAT,
            data=body,
            headers={**auth_headers, "Content-Type": "application/json"},
        )
        assert response.status == 400
        await response.read()
    assert fake_strata.requests == []


@pytest.mark.parametrize(
    "part",
    [
        {"type": "image_url", "image_url": {"url": "https://example.invalid/image.png"}},
        {"type": "input_audio", "input_audio": {"data": "AAAA", "format": "wav"}},
        {"type": "file", "file": {"file_id": "file-1"}},
    ],
)
async def test_non_text_content_blocks_are_rejected(gateway_server, fake_strata, auth_headers, part):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    payload = {"messages": [{"role": "user", "content": [{"type": "text", "text": "hello"}, part]}]}
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 400
        await response.read()
    assert fake_strata.requests == []


async def test_text_array_and_unknown_top_level_fields_pass(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    payload = {
        "messages": [{"role": "user", "content": [{"type": "text", "text": "hello"}]}],
        "unknown_field": {"kept": True},
    }
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 200
        await response.read()
    assert len(fake_strata.requests) == 1
    forwarded = json.loads(fake_strata.requests[0].body)
    assert forwarded["unknown_field"] == {"kept": True}
    assert forwarded["messages"][0]["content"] == [{"type": "text", "text": "hello"}]


async def test_tool_call_message_with_null_content_passes(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    payload = {
        "messages": [
            {
                "role": "assistant",
                "content": None,
                "tool_calls": [{"id": "call-1", "type": "function", "function": {"name": "ping", "arguments": "{}"}}],
            }
        ]
    }
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 200
        await response.read()
    assert len(fake_strata.requests) == 1


async def test_null_content_without_tool_calls_is_rejected(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    payload = {"messages": [{"role": "assistant", "content": None}]}
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 400
        await response.read()
    assert fake_strata.requests == []
