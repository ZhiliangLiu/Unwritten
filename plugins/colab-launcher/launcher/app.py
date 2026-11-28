import hashlib
import hmac
import json
import logging
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path

from aiohttp import web

from . import cli as colab
from .config import Config, ConfigError, load_config
from .machine import InvalidState, Machine

PROTOCOL = "unwritten-launcher/1"
IDLE_MINUTES_MIN = 5
IDLE_MINUTES_MAX = 720

CONFIG_KEY = web.AppKey("config", Config)
MACHINE_KEY = web.AppKey("machine", Machine)
IDEMPOTENCY_KEY = web.AppKey("idempotency", dict)
READINESS_KEY = web.AppKey("readiness", dict)


def _implementation() -> dict[str, str]:
    pyproject = Path(__file__).resolve().parent.parent / "pyproject.toml"
    project = tomllib.loads(pyproject.read_text())["project"]
    return {"name": project["name"], "version": project["version"]}


IMPLEMENTATION = _implementation()


@dataclass(frozen=True)
class _Cached:
    digest: str
    status: int
    body: dict[str, object]


def _error(status: int, code: str) -> web.Response:
    return web.json_response({"error": {"code": code, "message": code}}, status=status)


def _digest(path: str, payload: dict[str, object]) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{path}\n{canonical}".encode()).hexdigest()


def _replay(request: web.Request, payload: dict[str, object]) -> web.Response | None:
    key = payload["idempotencyKey"]
    cached = request.app[IDEMPOTENCY_KEY].get(key)
    if cached is None:
        return None
    if cached.digest != _digest(request.path, payload):
        return _error(409, "idempotency_conflict")
    return web.json_response(cached.body, status=cached.status)


def _remember(request: web.Request, payload: dict[str, object], status: int, body: dict[str, object]) -> web.Response:
    request.app[IDEMPOTENCY_KEY][payload["idempotencyKey"]] = _Cached(
        digest=_digest(request.path, payload), status=status, body=body
    )
    return web.json_response(body, status=status)


async def _payload(request: web.Request) -> dict[str, object] | None:
    try:
        value = await request.json()
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


def _idempotency_key(payload: dict[str, object]) -> str | None:
    key = payload.get("idempotencyKey")
    return key if isinstance(key, str) and key else None


@web.middleware
async def _auth(request: web.Request, handler) -> web.StreamResponse:
    expected = request.app[CONFIG_KEY].token
    header = request.headers.get("Authorization", "")
    supplied = header[7:] if header.startswith("Bearer ") else ""
    if not expected or not hmac.compare_digest(supplied.encode(), expected.encode()):
        return _error(401, "unauthorized")
    return await handler(request)


async def _info(request: web.Request) -> web.Response:
    readiness = request.app[READINESS_KEY]
    return web.json_response(
        {
            "protocol": PROTOCOL,
            "implementation": IMPLEMENTATION,
            "ready": readiness["ready"],
            "notReadyReason": readiness["reason"],
            "capabilities": {},
        }
    )


async def _state(request: web.Request) -> web.Response:
    return web.json_response(request.app[MACHINE_KEY].snapshot())


async def _start(request: web.Request) -> web.Response:
    payload = await _payload(request)
    if payload is None:
        return _error(400, "invalid_request")
    key = _idempotency_key(payload)
    if key is None:
        return _error(400, "invalid_request")
    replay = _replay(request, payload)
    if replay is not None:
        return replay
    idle_minutes = payload.get("idleMinutes")
    if (
        not isinstance(idle_minutes, int)
        or isinstance(idle_minutes, bool)
        or not IDLE_MINUTES_MIN <= idle_minutes <= IDLE_MINUTES_MAX
    ):
        return _error(400, "invalid_request")
    if not request.app[CONFIG_KEY].complete:
        return _error(503, "not_ready")
    snapshot = request.app[MACHINE_KEY].start(idle_minutes)
    return _remember(request, payload, 202, snapshot)


async def _continue(request: web.Request) -> web.Response:
    payload = await _payload(request)
    if payload is None or _idempotency_key(payload) is None:
        return _error(400, "invalid_request")
    replay = _replay(request, payload)
    if replay is not None:
        return replay
    try:
        snapshot = await request.app[MACHINE_KEY].continue_()
    except InvalidState:
        return _error(409, "invalid_state")
    return _remember(request, payload, 202, snapshot)


async def _stop(request: web.Request) -> web.Response:
    payload = await _payload(request)
    if payload is None or _idempotency_key(payload) is None:
        return _error(400, "invalid_request")
    replay = _replay(request, payload)
    if replay is not None:
        return replay
    await request.app[MACHINE_KEY].stop()
    return _remember(request, payload, 202, request.app[MACHINE_KEY].snapshot())


async def _not_found(request: web.Request) -> web.Response:
    return _error(404, "not_found")


async def _readiness(config: Config) -> tuple[dict[str, object], set[str] | None]:
    if not config.complete:
        return {"ready": False, "reason": "not_configured"}, None
    try:
        installed = await colab.version()
    except colab.CliError:
        return {"ready": False, "reason": "not_configured"}, None
    if installed != colab.pinned_version():
        return {"ready": False, "reason": "not_configured"}, None
    try:
        sessions = await colab.sessions()
    except colab.NotSignedIn:
        return {"ready": False, "reason": "not_signed_in"}, None
    except colab.CliError:
        return {"ready": False, "reason": "not_configured"}, None
    return {"ready": True, "reason": None}, sessions


async def _startup(app: web.Application) -> None:
    readiness, sessions = await _readiness(app[CONFIG_KEY])
    app[READINESS_KEY] = readiness
    if sessions is not None:
        await app[MACHINE_KEY].recover(sessions)


async def _cleanup(app: web.Application) -> None:
    await app[MACHINE_KEY].close()


def create_app(config: Config, *, machine: Machine | None = None) -> web.Application:
    app = web.Application(middlewares=[_auth])
    app[CONFIG_KEY] = config
    app[MACHINE_KEY] = machine if machine is not None else Machine(config)
    app[IDEMPOTENCY_KEY] = {}
    app[READINESS_KEY] = {"ready": False, "reason": "not_configured"}
    app.on_startup.append(_startup)
    app.on_cleanup.append(_cleanup)
    app.router.add_get("/v1/info", _info)
    app.router.add_get("/v1/state", _state)
    app.router.add_post("/v1/start", _start)
    app.router.add_post("/v1/continue", _continue)
    app.router.add_post("/v1/stop", _stop)
    app.router.add_route("*", "/{tail:.*}", _not_found)
    return app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    try:
        config = load_config()
    except ConfigError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2) from None
    web.run_app(create_app(config), host=config.listen, port=config.port)
