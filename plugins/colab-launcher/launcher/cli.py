import asyncio
import logging
import os
import time
from collections.abc import AsyncIterator
from pathlib import Path

logger = logging.getLogger("unwritten.launcher.cli")

COLAB_LOCK = Path(__file__).resolve().parent.parent / "colab-cli.lock"


class CliError(Exception):
    pass


class Quota(CliError):
    pass


class NotSignedIn(CliError):
    pass


def executable() -> str:
    return os.environ.get("UNWRITTEN_COLAB_BIN", "colab")


def pinned_version() -> str:
    return COLAB_LOCK.read_text().strip().partition("==")[2]


def _mentions(output: bytes, code: bytes) -> bool:
    return code in output


async def _spawn(*args: str, **kwargs) -> asyncio.subprocess.Process:
    try:
        return await asyncio.create_subprocess_exec(executable(), *args, **kwargs)
    except OSError:
        logger.warning("colab %s could not start", args[0])
        raise CliError(args[0]) from None


async def _run(*args: str) -> tuple[int, bytes, bytes]:
    started = time.monotonic()
    process = await _spawn(
        *args,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    logger.info(
        "colab %s exit=%s duration_ms=%d",
        args[0],
        process.returncode,
        int((time.monotonic() - started) * 1000),
    )
    return int(process.returncode or 0), stdout, stderr


def _failed(command: str, stdout: bytes, stderr: bytes) -> None:
    if _mentions(stdout + stderr, b"401"):
        raise NotSignedIn(command)
    raise CliError(command)


def _option(args: list[str], name: str) -> str | None:
    if name not in args:
        return None
    index = args.index(name)
    if index + 1 >= len(args):
        return None
    return args[index + 1]


class DrivemountHandle:
    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self._process = process

    async def read_url(self) -> str | None:
        if self._process.stdout is None:
            return None
        seen_marker = False
        while True:
            line = await self._process.stdout.readline()
            if not line:
                return None
            text = line.decode(errors="replace").strip()
            if "Please visit:" in text:
                seen_marker = True
                rest = text.split("Please visit:", 1)[1].strip()
                if rest.startswith(("http://", "https://")):
                    return rest
                continue
            if seen_marker and text.startswith(("http://", "https://")):
                return text

    async def continue_(self) -> None:
        if self._process.stdin is None:
            raise CliError("drivemount")
        self._process.stdin.write(b"\n")
        await self._process.stdin.drain()

    async def wait(self) -> int:
        return int(await self._process.wait())

    async def terminate(self) -> None:
        if self._process.returncode is None:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass
        await self._process.wait()


class ExecHandle:
    def __init__(self, process: asyncio.subprocess.Process) -> None:
        self._process = process

    async def lines(self) -> AsyncIterator[str]:
        if self._process.stdout is None:
            return
        while True:
            line = await self._process.stdout.readline()
            if not line:
                return
            yield line.decode(errors="replace").rstrip("\r\n")

    async def wait(self) -> int:
        return int(await self._process.wait())

    async def terminate(self) -> None:
        if self._process.returncode is None:
            try:
                self._process.terminate()
            except ProcessLookupError:
                pass
        await self._process.wait()


async def version() -> str:
    code, stdout, stderr = await _run("version")
    if code != 0:
        _failed("version", stdout, stderr)
    tokens = stdout.decode(errors="replace").split()
    if not tokens:
        raise CliError("version")
    return tokens[-1]


async def sessions() -> set[str]:
    code, stdout, stderr = await _run("sessions")
    if code != 0:
        _failed("sessions", stdout, stderr)
    names: set[str] = set()
    for line in stdout.decode(errors="replace").splitlines():
        text = line.strip()
        if not text.startswith("["):
            continue
        end = text.find("]")
        if end > 1:
            names.add(text[1:end])
    return names


async def new(session: str, gpu: str, high_mem: bool) -> None:
    args = ["new", "-s", session, "--gpu", gpu]
    if high_mem:
        args.append("--high-mem")
    code, stdout, stderr = await _run(*args)
    if code == 0:
        return
    if _mentions(stdout + stderr, b"400"):
        raise Quota("new")
    _failed("new", stdout, stderr)


async def upload(session: str, local: Path, remote: str) -> None:
    code, stdout, stderr = await _run("upload", "-s", session, str(local), remote)
    if code != 0:
        _failed("upload", stdout, stderr)


async def drivemount(session: str) -> DrivemountHandle:
    process = await _spawn(
        "drivemount",
        "-s",
        session,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    logger.info("colab drivemount started")
    return DrivemountHandle(process)


async def exec(session: str, file: Path) -> ExecHandle:
    process = await _spawn(
        "exec",
        "-s",
        session,
        "--timeout",
        "0",
        "-f",
        str(file),
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
    )
    logger.info("colab exec started")
    return ExecHandle(process)


async def stop(session: str) -> None:
    code, stdout, stderr = await _run("stop", "-s", session)
    if code in (0, 1):
        return
    _failed("stop", stdout, stderr)
