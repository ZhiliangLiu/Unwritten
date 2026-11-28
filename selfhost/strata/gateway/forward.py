import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import aiohttp
from aiohttp import web

from .config import Config

logger = logging.getLogger("gateway")

CHAT_PATH = "/v1/chat/completions"
MODELS_PATH = "/v1/models"

SKIPPED_RESPONSE_HEADERS = frozenset(
    {
        "connection",
        "content-encoding",
        "content-length",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailer",
        "transfer-encoding",
        "upgrade",
    }
)


def error_response(
    status: int,
    message: str,
    code: str | None = None,
    error_type: str = "invalid_request_error",
) -> web.Response:
    error: dict[str, str] = {"message": message, "type": error_type}
    if code is not None:
        error["code"] = code
    return web.json_response({"error": error}, status=status)


def upstream_headers(config: Config, content_type: str | None, accept: str | None) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {config.internal_key}"}
    if content_type:
        headers["Content-Type"] = content_type
    if accept:
        headers["Accept"] = accept
    return headers


def response_headers(headers: Any) -> dict[str, str]:
    kept: dict[str, str] = {}
    for name, value in headers.items():
        lowered = name.lower()
        if lowered.startswith("access-control-") or lowered in SKIPPED_RESPONSE_HEADERS:
            continue
        kept[name] = value
    return kept


@asynccontextmanager
async def open_upstream(
    config: Config,
    method: str,
    path: str,
    body: bytes | None = None,
    *,
    content_type: str | None = None,
    accept: str | None = None,
) -> AsyncIterator[aiohttp.ClientResponse]:
    timeout = aiohttp.ClientTimeout(total=None, sock_connect=10)
    async with aiohttp.ClientSession(timeout=timeout) as session:
        async with session.request(
            method,
            config.strata_url + path,
            data=body,
            headers=upstream_headers(config, content_type, accept),
            allow_redirects=False,
        ) as response:
            yield response


async def copy_response(upstream: aiohttp.ClientResponse, request: web.Request) -> web.StreamResponse:
    if 300 <= upstream.status < 400:
        await upstream.read()
        return error_response(502, "upstream redirected", "upstream_redirected", "upstream_error")

    response = web.StreamResponse(
        status=upstream.status,
        reason=upstream.reason,
        headers=response_headers(upstream.headers),
    )
    await response.prepare(request)
    try:
        async for chunk in upstream.content.iter_any():
            await response.write(chunk)
        await response.write_eof()
    except ConnectionResetError:
        logger.debug("client disconnected while streaming")
    return response
