import asyncio
import logging

import aiohttp

CHAT = "/v1/chat/completions"
SENTINEL = "SENTINEL-PROMPT-42"


async def test_logs_exclude_prompts_and_tokens(gateway_server, fake_strata, auth_headers, caplog):
    caplog.set_level(logging.INFO, logger="gateway")
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    payload = {"messages": [{"role": "user", "content": SENTINEL}]}
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        assert response.status == 200
        await response.read()
    assert len(fake_strata.requests) == 1
    for _ in range(20):
        if CHAT in caplog.text and "200" in caplog.text:
            break
        await asyncio.sleep(0.01)
    assert SENTINEL not in caplog.text
    assert gateway.config.token not in caplog.text
    assert gateway.config.internal_key not in caplog.text
    assert CHAT in caplog.text
    assert "200" in caplog.text
