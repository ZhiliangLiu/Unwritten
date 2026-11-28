import asyncio
import logging
import time
from pathlib import Path
from urllib.parse import urlsplit

from . import cli as colab
from . import packaging
from .config import Config
from .status_lines import parse

logger = logging.getLogger("unwritten.launcher")

ACTION_LIFETIME_S = 600
LAUNCHER_SESSION_CHECK_S = 60
WAIT_POLL_S = 0.5
BOOTSTRAP_PATH = Path(__file__).resolve().parent.parent / "bootstrap.py"
REMOTE_UPLOAD = "/content/unwritten/upload.tar"
REMOTE_LAUNCH = "/content/unwritten/launch.json"


class InvalidState(Exception):
    pass


class ActionExpired(Exception):
    pass


class StartError(Exception):
    pass


def action_url_allowed(url: str) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    if parts.scheme != "https":
        return False
    host = (parts.hostname or "").lower()
    return host == "google.com" or host.endswith(".google.com")


class Machine:
    def __init__(
        self,
        config: Config,
        *,
        clock=time.time,
        sleep=asyncio.sleep,
        session_check_interval: float = LAUNCHER_SESSION_CHECK_S,
    ) -> None:
        self.config = config
        self.service = config.service
        self.state = "stopped"
        self.reason: str | None = None
        self.action: dict[str, object] | None = None
        self.since = int(clock())
        self._clock = clock
        self._sleep = sleep
        self._session_check_interval = session_check_interval
        self._generation = 0
        self._pending_idle: int | None = None
        self._continue_event = asyncio.Event()
        self._action_expires_at = 0
        self._task: asyncio.Task[None] | None = None
        self._watch_task: asyncio.Task[None] | None = None
        self._exec: colab.ExecHandle | None = None
        self._drivemount: colab.DrivemountHandle | None = None

    def snapshot(self) -> dict[str, object]:
        return {"state": self.state, "reason": self.reason, "action": self.action, "since": self.since}

    def _enter(self, state: str, *, reason: str | None = None, action: dict[str, object] | None = None) -> None:
        self.state = state
        self.reason = reason
        self.action = action
        self.since = int(self._clock())
        logger.info("state %s", state)

    def _active(self, generation: int) -> bool:
        return generation == self._generation

    def start(self, idle_minutes: int) -> dict[str, object]:
        if self.state in ("starting", "needs_action", "running"):
            return self.snapshot()
        if self.state == "stopping":
            self._pending_idle = idle_minutes
            return self.snapshot()
        if self.service is None or not self.config.complete:
            return self.snapshot()
        self._begin(idle_minutes)
        return self.snapshot()

    def _begin(self, idle_minutes: int) -> None:
        self._generation += 1
        self._pending_idle = None
        self._continue_event.clear()
        self._enter("starting")
        self._task = asyncio.ensure_future(self._run(self._generation, idle_minutes))

    async def continue_(self) -> dict[str, object]:
        if self.state != "needs_action" or self._drivemount is None:
            raise InvalidState()
        await self._drivemount.continue_()
        self._continue_event.set()
        self._enter("starting")
        return self.snapshot()

    async def stop(self) -> None:
        if self.state == "stopped":
            self._pending_idle = None
            return
        self._generation += 1
        self._enter("stopping")
        self._continue_event.set()
        await self._close_handles()
        if self.service is not None:
            try:
                await colab.stop(self.service.session)
            except (colab.CliError, colab.NotSignedIn):
                logger.warning("stop command failed")
        self._enter("stopped")
        pending = self._pending_idle
        self._pending_idle = None
        if pending is not None:
            self._begin(pending)

    async def recover(self, sessions: set[str] | None = None) -> None:
        if self.service is None or not self.config.complete:
            return
        if sessions is None:
            try:
                sessions = await colab.sessions()
            except (colab.CliError, colab.NotSignedIn):
                return
        if self.service.session in sessions:
            self._enter("running")
            self._watch_sessions()
        else:
            self._enter("stopped")

    async def close(self) -> None:
        await self.stop()

    async def _run(self, generation: int, idle_minutes: int) -> None:
        service = self.service
        if service is None:
            return
        try:
            sessions = await colab.sessions()
            if not self._active(generation):
                return
            if service.session in sessions:
                await colab.stop(service.session)
            await colab.new(service.session, service.gpu, service.high_mem)
            if not self._active(generation):
                if generation + 1 == self._generation:
                    try:
                        await colab.stop(service.session)
                    except (colab.CliError, colab.NotSignedIn):
                        logger.warning("stop command failed")
                return

            archive = packaging.pack(self.config.host_dir, service.code)
            launch = packaging.write_launch_file(service.token, service.tailscale_auth_key, idle_minutes)
            try:
                await colab.upload(service.session, archive, REMOTE_UPLOAD)
                await colab.upload(service.session, launch, REMOTE_LAUNCH)
            finally:
                launch.unlink(missing_ok=True)
            if not self._active(generation):
                return

            handle = await colab.drivemount(service.session)
            self._drivemount = handle
            if not self._active(generation):
                await handle.terminate()
                return
            url = await handle.read_url()
            if not self._active(generation):
                await handle.terminate()
                return
            if url is not None:
                if not action_url_allowed(url):
                    raise StartError("invalid action url")
                self._action_expires_at = int(self._clock() + ACTION_LIFETIME_S)
                self._enter(
                    "needs_action",
                    action={"url": url, "expiresAt": self._action_expires_at},
                )
                continued = await self._wait_continue()
                if not self._active(generation):
                    return
                if not continued:
                    raise ActionExpired()
            code = await handle.wait()
            self._drivemount = None
            if not self._active(generation):
                return
            if code != 0:
                raise StartError("drivemount failed")

            handle = await colab.exec(service.session, BOOTSTRAP_PATH)
            self._exec = handle
            if not self._active(generation):
                await handle.terminate()
                return
            self._enter("starting")
            async for line in handle.lines():
                if not self._active(generation):
                    return
                status = parse(line)
                if status is None:
                    continue
                if status["phase"] == "serving":
                    self._enter("running")
                    self._watch_sessions()
                elif status["phase"] == "exiting":
                    if status.get("reason") == "error":
                        raise StartError("host reported error")
                    break

            if not self._active(generation):
                return
            if self.state == "running":
                self._enter("stopping")
                if self._exec is not None:
                    await self._exec.terminate()
                await colab.stop(service.session)
                if self._active(generation):
                    self._enter("stopped")
            elif self.state == "starting":
                raise StartError("host exited before serving")
        except ActionExpired:
            await self._fail(generation, "action_expired")
        except colab.Quota:
            await self._fail(generation, "quota")
        except colab.NotSignedIn:
            await self._fail(generation, "not_signed_in")
        except (colab.CliError, StartError, OSError):
            await self._fail(generation, "start_error")
        except Exception as error:
            logger.warning("start failed: %s", type(error).__name__)
            await self._fail(generation, "start_error")
        finally:
            self._exec = None
            self._drivemount = None

    async def _wait_continue(self) -> bool:
        while not self._continue_event.is_set():
            remaining = self._action_expires_at - self._clock()
            if remaining <= 0:
                return False
            await self._sleep(min(remaining, WAIT_POLL_S))
        return True

    def _watch_sessions(self) -> None:
        if self._watch_task is not None and not self._watch_task.done():
            return
        self._watch_task = asyncio.ensure_future(self._check_sessions())

    async def _check_sessions(self) -> None:
        while True:
            await asyncio.sleep(self._session_check_interval)
            if self.state != "running":
                return
            try:
                sessions = await colab.sessions()
            except (colab.CliError, colab.NotSignedIn):
                continue
            if self.state == "running" and self.service is not None and self.service.session not in sessions:
                self._enter("stopped")
                return

    async def _fail(self, generation: int, reason: str) -> None:
        if not self._active(generation):
            return
        self._generation += 1
        self._continue_event.set()
        self._enter("failed", reason=reason)
        await self._close_handles()
        if self.service is not None:
            try:
                await colab.stop(self.service.session)
            except (colab.CliError, colab.NotSignedIn):
                logger.warning("stop command failed")

    async def _close_handles(self) -> None:
        watch = self._watch_task
        self._watch_task = None
        if watch is not None and not watch.done():
            watch.cancel()
        for attr in ("_exec", "_drivemount"):
            handle = getattr(self, attr)
            setattr(self, attr, None)
            if handle is None:
                continue
            try:
                await handle.terminate()
            except ProcessLookupError:
                pass
