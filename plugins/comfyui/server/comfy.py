import asyncio
import json
from collections.abc import Awaitable, Callable
from typing import Any

import aiohttp

from .config import POLL_INTERVAL_S


class ComfyError(Exception):
    pass


class InternalError(ComfyError):
    pass


class WorkflowError(ComfyError):
    pass


class OutOfMemory(ComfyError):
    pass


class Interrupted(ComfyError):
    pass


def _error_text(entry: dict[str, Any]) -> str:
    status = entry.get("status")
    if not isinstance(status, dict):
        return ""
    parts: list[str] = []
    for message in status.get("messages", []):
        if isinstance(message, list) and len(message) > 1 and isinstance(message[1], dict):
            parts.extend(str(value) for value in message[1].values())
    return " ".join(parts)


def _parse_history(entry: dict[str, Any]) -> list[dict[str, Any]]:
    status = entry.get("status")
    if isinstance(status, dict) and status.get("status_str") == "error":
        text = _error_text(entry).lower()
        if "out of memory" in text:
            raise OutOfMemory("out of memory")
        raise WorkflowError("workflow failed")
    outputs = entry.get("outputs")
    if not isinstance(outputs, dict):
        raise InternalError("history has no outputs")
    files: list[dict[str, Any]] = []
    for output in outputs.values():
        if not isinstance(output, dict):
            continue
        for image in output.get("images", []):
            if isinstance(image, dict) and isinstance(image.get("filename"), str):
                files.append(image)
    if not files:
        raise WorkflowError("workflow produced no image")
    return files


class ComfyClient:
    def __init__(
        self,
        base_url: str,
        session: aiohttp.ClientSession,
        *,
        poll_interval: float = POLL_INTERVAL_S,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.session = session
        self.poll_interval = poll_interval
        self.sleep = sleep

    async def _request(self, method: str, path: str, **kwargs: Any) -> tuple[int, str]:
        try:
            async with self.session.request(method, f"{self.base_url}{path}", **kwargs) as response:
                return response.status, await response.text()
        except (aiohttp.ClientError, OSError) as error:
            raise InternalError("comfyui unreachable") from error

    async def submit(self, graph: dict[str, Any]) -> str:
        status, body = await self._request("POST", "/prompt", json={"prompt": graph})
        if status == 400:
            raise WorkflowError("comfyui rejected the workflow")
        if status != 200:
            raise InternalError(f"comfyui prompt returned status {status}")
        try:
            payload = json.loads(body)
            prompt_id = payload["prompt_id"]
        except (json.JSONDecodeError, KeyError, TypeError) as error:
            raise InternalError("comfyui returned an invalid prompt response") from error
        if not isinstance(prompt_id, str) or not prompt_id:
            raise InternalError("comfyui returned an invalid prompt id")
        return prompt_id

    async def wait(self, prompt_id: str, *, cancelled: Callable[[], bool]) -> list[dict[str, Any]]:
        while True:
            if cancelled():
                await self.interrupt()
                raise Interrupted("interrupted")
            status, body = await self._request("GET", f"/history/{prompt_id}")
            if status != 200:
                raise InternalError(f"comfyui history returned status {status}")
            try:
                history = json.loads(body)
            except json.JSONDecodeError as error:
                raise InternalError("comfyui returned invalid history") from error
            if isinstance(history, dict) and prompt_id in history:
                return _parse_history(history[prompt_id])
            await self.sleep(self.poll_interval)

    async def generate(self, graph: dict[str, Any], *, cancelled: Callable[[], bool]) -> list[dict[str, Any]]:
        prompt_id = await self.submit(graph)
        return await self.wait(prompt_id, cancelled=cancelled)

    async def interrupt(self) -> None:
        status, _ = await self._request("POST", "/interrupt")
        if status not in (200, 204):
            raise InternalError(f"comfyui interrupt returned status {status}")
