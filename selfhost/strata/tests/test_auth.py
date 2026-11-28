import aiohttp
import pytest
from conftest import CALLER_HEADER

from gateway.config import load

SHORT_VALUE = "sk-test-SECRET-123"


async def test_missing_and_wrong_tokens_are_rejected(gateway_server, fake_strata, auth_headers):
    gateway = await gateway_server()
    gateway.state.set_ready(True, None)
    async with aiohttp.ClientSession() as session:
        missing = await session.get(f"{gateway.url}/v1/models")
        wrong = await session.get(
            f"{gateway.url}/v1/models",
            headers={"Authorization": "Bearer wrong-token-0123456789abcdef0123456789"},
        )
        assert missing.status == 401
        assert wrong.status == 401
        assert fake_strata.requests == []
        accepted = await session.get(f"{gateway.url}/v1/models", headers=auth_headers)
        assert accepted.status == 200
        await accepted.read()
    assert [request.path for request in fake_strata.requests] == ["/v1/models"]


def test_short_token_exits_without_printing_it():
    with pytest.raises(SystemExit) as error:
        load({"UNWRITTEN_LLM_TOKEN": SHORT_VALUE, "STRATA_INTERNAL_KEY": "internal-test-key"})
    assert SHORT_VALUE not in str(error.value)
    assert "32" in str(error.value)


def test_missing_internal_key_exits():
    with pytest.raises(SystemExit) as error:
        load({"UNWRITTEN_LLM_TOKEN": CALLER_HEADER})
    assert "STRATA_INTERNAL_KEY" in str(error.value)
