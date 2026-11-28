import asyncio

import aiohttp

CHAT = "/v1/chat/completions"


async def test_client_disconnect_closes_upstream(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    fake_strata.long_stream = True
    payload = {"messages": [{"role": "user", "content": "hello"}], "stream": True}
    async with aiohttp.ClientSession() as session:
        response = await session.post(gateway.url + CHAT, json=payload, headers=auth_headers)
        first = await asyncio.wait_for(response.content.readany(), timeout=1.0)
        assert b"data:" in first
        response.close()
    for _ in range(60):
        if fake_strata.disconnected:
            break
        await asyncio.sleep(0.05)
    assert fake_strata.disconnected
    for _ in range(40):
        if gateway.state.in_flight == 0:
            break
        await asyncio.sleep(0.05)
    assert gateway.state.in_flight == 0
