import asyncio
import json
import logging
import time
from collections.abc import Awaitable, Callable

import aiohttp

from . import forward
from .config import Config
from .state_file import GatewayState

logger = logging.getLogger("gateway")

SELFTEST_REQUEST = {
    "model": "strata",
    "messages": [{"role": "user", "content": "Call the ping tool with the word ok."}],
    "tools": [
        {
            "type": "function",
            "function": {
                "name": "ping",
                "description": "Report that the model service can run tool calls.",
                "parameters": {
                    "type": "object",
                    "properties": {"word": {"type": "string"}},
                    "required": ["word"],
                },
            },
        }
    ],
    "tool_choice": {"type": "function", "function": {"name": "ping"}},
    "stream": True,
    "reasoning_effort": "none",
}


def collect_tool_calls(raw: object, calls: dict[int, dict[str, str]]) -> None:
    if not isinstance(raw, list):
        return
    for position, call in enumerate(raw):
        if not isinstance(call, dict):
            continue
        index = call.get("index")
        key = index if isinstance(index, int) else position
        entry = calls.setdefault(key, {"name": "", "arguments": ""})
        function = call.get("function")
        if not isinstance(function, dict):
            continue
        name = function.get("name")
        if isinstance(name, str):
            entry["name"] += name
        arguments = function.get("arguments")
        if isinstance(arguments, str):
            entry["arguments"] += arguments


def has_ping(calls: dict[int, dict[str, str]]) -> bool:
    for entry in calls.values():
        if entry["name"] != "ping":
            continue
        try:
            arguments = json.loads(entry["arguments"])
        except ValueError:
            continue
        if isinstance(arguments, dict) and len(arguments) == 1 and isinstance(arguments.get("word"), str):
            return True
    return False


def parse_answer(data: bytes) -> tuple[bool, bool]:
    text = data.decode("utf-8", errors="replace")
    calls: dict[int, dict[str, str]] = {}
    done = False
    saw_event = False
    for line in text.splitlines():
        if not line.startswith("data:"):
            continue
        saw_event = True
        payload = line[len("data:") :].strip()
        if payload == "[DONE]":
            done = True
            continue
        try:
            event = json.loads(payload)
        except ValueError:
            continue
        if not isinstance(event, dict):
            continue
        choices = event.get("choices")
        if not isinstance(choices, list):
            continue
        for choice in choices:
            if not isinstance(choice, dict):
                continue
            delta = choice.get("delta")
            if isinstance(delta, dict):
                collect_tool_calls(delta.get("tool_calls"), calls)
            message = choice.get("message")
            if isinstance(message, dict):
                collect_tool_calls(message.get("tool_calls"), calls)
            if choice.get("finish_reason") is not None:
                done = True
    if saw_event:
        return has_ping(calls), done
    try:
        event = json.loads(text)
    except ValueError:
        return False, False
    if not isinstance(event, dict):
        return False, False
    choices = event.get("choices")
    if not isinstance(choices, list) or not choices:
        return False, False
    first = choices[0]
    if not isinstance(first, dict):
        return False, False
    message = first.get("message")
    if not isinstance(message, dict):
        return False, False
    collect_tool_calls(message.get("tool_calls"), calls)
    return has_ping(calls), True


async def attempt(config: Config, timeout_s: float) -> tuple[bool, bool]:
    body = json.dumps(SELFTEST_REQUEST).encode()
    try:
        async with asyncio.timeout(timeout_s):
            async with forward.open_upstream(
                config,
                "POST",
                forward.CHAT_PATH,
                body,
                content_type="application/json",
                accept="text/event-stream",
            ) as upstream:
                data = await upstream.read()
                if upstream.status != 200:
                    return False, False
                return parse_answer(data)
    except (TimeoutError, aiohttp.ClientError, OSError):
        return False, False


async def run(
    config: Config,
    state: GatewayState,
    *,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    load_timeout_s: float | None = None,
    interval_s: float | None = None,
) -> bool:
    timeout = config.load_timeout_s if load_timeout_s is None else load_timeout_s
    interval = config.health_interval_s if interval_s is None else interval_s
    deadline = clock() + timeout
    attempts = 0
    last_complete = False
    while clock() < deadline:
        attempts += 1
        budget = min(interval, deadline - clock())
        passed, complete = await attempt(config, budget)
        if passed:
            state.mark_selftest_passed()
            logger.info("self test passed after %d attempts", attempts)
            return True
        last_complete = complete
        if clock() >= deadline:
            break
        await sleep(min(interval, deadline - clock()))
    reason = "self_test_failed" if last_complete else "load_timeout"
    state.mark_selftest_failed(reason)
    logger.warning("self test failed: %s after %d attempts", reason, attempts)
    return False
