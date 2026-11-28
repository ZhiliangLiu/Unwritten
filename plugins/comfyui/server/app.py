import asyncio
import hmac
import logging
import time
from collections.abc import Callable
from typing import Any

import aiohttp
from aiohttp import web

from . import selftest
from .comfy import ComfyClient
from .config import Config
from .jobs import ApiError, JobStore
from .manifest import Manifest

logger = logging.getLogger("server.app")
REFERENCE_BASE64_OVERHEAD = 4
BUSY_RETRY_AFTER_S = 5
WRAPPER_KEY: web.AppKey[Any] = web.AppKey("wrapper", object)


def _error(code: str, message: str, status: int) -> web.Response:
    response = web.json_response({"error": {"code": code, "message": message}}, status=status)
    if status == 429:
        response.headers["Retry-After"] = str(BUSY_RETRY_AFTER_S)
    return response


def _client_max_size(manifest: Manifest) -> int:
    encoded = (manifest.max_reference_bytes * REFERENCE_BASE64_OVERHEAD + 2) // 3
    return manifest.max_references * encoded + 65536


def _auth_middleware(token: str) -> Callable[..., Any]:
    expected = f"Bearer {token}".encode()

    @web.middleware
    async def authenticate(request: web.Request, handler: Callable[[web.Request], Any]) -> web.StreamResponse:
        supplied = request.headers.get("Authorization", "").encode()
        if not hmac.compare_digest(supplied, expected):
            return _error("unauthorized", "unauthorized", 401)
        try:
            return await handler(request)
        except ApiError as error:
            return _error(error.code, error.message, error.status)
        except web.HTTPException:
            raise
        except Exception:
            logger.exception("request failed")
            return _error("internal", "internal error", 500)

    return authenticate


class Wrapper:
    def __init__(
        self,
        config: Config,
        manifest: Manifest,
        *,
        run_selftest: bool,
        clock: Callable[[], float],
        start_worker: bool,
    ) -> None:
        self.config = config
        self.manifest = manifest
        self.run_selftest = run_selftest
        self.clock = clock
        self.start_worker = start_worker
        self.session: aiohttp.ClientSession | None = None
        self.jobs: JobStore | None = None
        self._selftest_task: asyncio.Task[None] | None = None

    async def startup(self, app: web.Application) -> None:
        self.session = aiohttp.ClientSession()
        comfy = ComfyClient(self.config.comfy_url, self.session)
        self.jobs = JobStore(self.manifest, self.config, comfy, clock=self.clock)
        self.jobs.write_state()
        if self.start_worker:
            self.jobs.start_worker()
        if self.run_selftest:
            self._selftest_task = asyncio.create_task(self._run_selftest())
        else:
            self.jobs.set_ready(True, None)

    async def _run_selftest(self) -> None:
        if self.jobs is None or self.session is None:
            return
        comfy = ComfyClient(self.config.comfy_url, self.session)
        ready, reason = await selftest.run(self.manifest, comfy, self.config)
        self.jobs.set_ready(ready, reason)

    async def cleanup(self, app: web.Application) -> None:
        if self._selftest_task is not None:
            self._selftest_task.cancel()
            try:
                await self._selftest_task
            except asyncio.CancelledError:
                pass
        if self.jobs is not None:
            await self.jobs.stop_worker()
        if self.session is not None:
            await self.session.close()


def _jobs(request: web.Request) -> JobStore:
    store = request.app[WRAPPER_KEY].jobs
    if store is None:
        raise ApiError(503, "not_ready", "service is starting")
    return store


async def _handle_info(request: web.Request) -> web.Response:
    wrapper = request.app[WRAPPER_KEY]
    store = _jobs(request)
    return web.json_response(wrapper.manifest.info(store.ready, store.reason, store.pending_count()))


async def _handle_submit(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except ValueError:
        raise ApiError(400, "invalid_request", "invalid json") from None
    if not isinstance(body, dict):
        raise ApiError(400, "invalid_request", "request body must be an object")
    payload = _jobs(request).submit(body)
    return web.json_response(payload, status=202)


async def _handle_status(request: web.Request) -> web.Response:
    return web.json_response(_jobs(request).status(request.match_info["job_id"]))


async def _handle_image(request: web.Request) -> web.Response:
    return web.Response(body=_jobs(request).image(request.match_info["job_id"]), content_type="image/webp")


async def _handle_cancel(request: web.Request) -> web.Response:
    await _jobs(request).cancel(request.match_info["job_id"])
    return web.Response(status=204)


def create_app(
    config: Config,
    manifest: Manifest,
    *,
    run_selftest: bool = True,
    clock: Callable[[], float] | None = None,
    start_worker: bool = True,
) -> web.Application:
    app = web.Application(
        client_max_size=_client_max_size(manifest),
        middlewares=[_auth_middleware(config.token)],
    )
    wrapper = Wrapper(
        config,
        manifest,
        run_selftest=run_selftest,
        clock=clock if clock is not None else time.time,
        start_worker=start_worker,
    )
    app[WRAPPER_KEY] = wrapper
    app.router.add_get("/v1/info", _handle_info)
    app.router.add_post("/v1/jobs", _handle_submit)
    app.router.add_get("/v1/jobs/{job_id}", _handle_status)
    app.router.add_get("/v1/jobs/{job_id}/image", _handle_image)
    app.router.add_delete("/v1/jobs/{job_id}", _handle_cancel)
    app.on_startup.append(wrapper.startup)
    app.on_cleanup.append(wrapper.cleanup)
    return app
