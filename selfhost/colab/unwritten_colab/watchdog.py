from collections.abc import Callable, Iterable
from pathlib import Path
from typing import Any

from .state import read_state

CHECK_INTERVAL_SECONDS = 60


def watch(
    *,
    processes: Iterable[tuple[str, Any]],
    state_path: Path,
    idle_minutes: int,
    clock: Callable[[], float],
    sleep: Callable[[float], None],
    unassign: Callable[[], None],
    log: Callable[[str], None],
    status: Callable[..., None] | None = None,
) -> str:
    started_at = clock()
    watched = list(processes)
    reported: set[int] = set()
    while True:
        state = read_state(state_path)
        for name, process in watched:
            exit_code = process.poll()
            if exit_code is None or id(process) in reported:
                continue
            reported.add(id(process))
            log(f"{name} exited with code {exit_code}")
        if state is not None and state.in_flight > 0:
            idle_seconds = 0.0
        else:
            since = state.last_activity_at if state is not None and state.last_activity_at is not None else started_at
            idle_seconds = max(0.0, clock() - since)
        ready = state.ready if state is not None else False
        reason = state.not_ready_reason if state is not None else "unknown"
        log(f"ready={ready} not_ready_reason={reason or '-'} idle_minutes={int(idle_seconds // 60)}")
        if idle_seconds >= idle_minutes * CHECK_INTERVAL_SECONDS:
            exit_reason = "process_exit" if reported else "idle"
            if status is not None:
                status("exiting", reason=exit_reason)
            unassign()
            return exit_reason
        sleep(CHECK_INTERVAL_SECONDS)
