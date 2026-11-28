import hmac
import json
import logging
import time
from collections.abc import Awaitable, Callable
from contextlib import AsyncExitStack

import aiohttp
from aiohttp import web

from . import forward
from .config import Config
from .state_file import GatewayState

logger = logging.getLogger("gateway")

CONFIG_KEY = web.AppKey("config", Config)
STATE_KEY = web.AppKey("state", GatewayState)
GATED_ROUTES = frozenset(
    {
        ("GET", forward.MODELS_PATH),
        ("POST", forward.CHAT_PATH),
    }
)

Handler = Callable[[web.Request], Awaitable[web.StreamResponse]]


def messages_are_text_only(messages: object) -> bool:
    if not isinstance(messages, list):
        return True
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if content is None:
            if message.get("role") == "assistant" and isinstance(message.get("tool_calls"), list):
                continue
            return False
        if isinstance(content, str):
            continue
        if not isinstance(content, list):
            return False
        for part in content:
            if not isinstance(part, dict) or part.get("type") != "text":
                return False
    return True


@web.middleware
async def log_request(request: web.Request, handler: Handler) -> web.StreamResponse:
    started = time.monotonic()
    status = 500
    try:
        response = await handler(request)
        status = response.status
        return response
    except web.HTTPException as error:
        status = error.status
        raise
    finally:
        duration_ms = (time.monotonic() - started) * 1000
        logger.info("%s %s %s %.1fms", request.method, request.path, status, duration_ms)


@web.middleware
async def authenticate(request: web.Request, handler: Handler) -> web.StreamResponse:
    header = request.headers.get("Authorization", "")
    prefix = "Bearer "
    if not header.startswith(prefix):
        return forward.error_response(401, "unauthorized", "unauthorized", "authentication_error")
    supplied = header[len(prefix) :]
    expected = request.app[CONFIG_KEY].token
    if not hmac.compare_digest(supplied.encode("utf-8", "surrogatepass"), expected.encode("utf-8", "surrogatepass")):
        return forward.error_response(401, "unauthorized", "unauthorized", "authentication_error")
    return await handler(request)


@web.middleware
async def require_ready(request: web.Request, handler: Handler) -> web.StreamResponse:
    if (request.method, request.path) in GATED_ROUTES and not request.app[STATE_KEY].ready:
        return forward.error_response(503, "model service not ready", "not_ready", "service_unavailable")
    return await handler(request)


async def relay(
    request: web.Request,
    method: str,
    path: str,
    body: bytes | None = None,
    *,
    content_type: str | None = None,
) -> web.StreamResponse:
    config = request.app[CONFIG_KEY]
    async with AsyncExitStack() as stack:
        try:
            upstream = await stack.enter_async_context(
                forward.open_upstream(
                    config,
                    method,
                    path,
                    body,
                    content_type=content_type,
                    accept=request.headers.get("Accept"),
                )
            )
        except (aiohttp.ClientError, TimeoutError) as error:
            logger.warning("upstream request failed: %s", type(error).__name__)
            return forward.error_response(502, "model service unavailable", "upstream_unavailable", "upstream_error")
        return await forward.copy_response(upstream, request)


async def handle_models(request: web.Request) -> web.StreamResponse:
    state = request.app[STATE_KEY]
    state.begin_request()
    try:
        return await relay(request, "GET", forward.MODELS_PATH)
    finally:
        state.end_request()


async def handle_chat(request: web.Request) -> web.StreamResponse:
    try:
        body = await request.read()
    except web.HTTPRequestEntityTooLarge:
        return forward.error_response(413, "request body too large", "payload_too_large")
    try:
        payload = json.loads(body)
    except ValueError:
        return forward.error_response(400, "request body must be a JSON object", "invalid_body")
    if not isinstance(payload, dict):
        return forward.error_response(400, "request body must be a JSON object", "invalid_body")
    if not messages_are_text_only(payload.get("messages")):
        return forward.error_response(400, "only text message content is supported", "unsupported_content")

    state = request.app[STATE_KEY]
    state.begin_request()
    try:
        return await relay(
            request,
            "POST",
            forward.CHAT_PATH,
            body,
            content_type=request.headers.get("Content-Type", "application/json"),
        )
    finally:
        state.end_request()


async def not_found(request: web.Request) -> web.StreamResponse:
    return forward.error_response(404, "not found", "not_found")


def create_app(config: Config, state: GatewayState) -> web.Application:
    app = web.Application(
        middlewares=[log_request, authenticate, require_ready],
        client_max_size=config.max_body_bytes,
    )
    app[CONFIG_KEY] = config
    app[STATE_KEY] = state
    app.router.add_get(forward.MODELS_PATH, handle_models, allow_head=False)
    app.router.add_post(forward.CHAT_PATH, handle_chat)
    app.router.add_route("*", "/{tail:.*}", not_found)
    return app
