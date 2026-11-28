import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ServiceState:
    ready: bool
    not_ready_reason: str | None
    in_flight: int
    last_activity_at: float | None


def read_state(path: Path) -> ServiceState | None:
    try:
        data = json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    ready = data.get("ready")
    reason = data.get("notReadyReason")
    in_flight = data.get("inFlight")
    last_activity_at = data.get("lastActivityAt")
    if not isinstance(ready, bool):
        return None
    if reason is not None and not isinstance(reason, str):
        return None
    if not isinstance(in_flight, int) or isinstance(in_flight, bool) or in_flight < 0:
        return None
    if last_activity_at is not None and (
        isinstance(last_activity_at, bool) or not isinstance(last_activity_at, (int, float))
    ):
        return None
    return ServiceState(
        ready=ready,
        not_ready_reason=reason,
        in_flight=in_flight,
        last_activity_at=last_activity_at,
    )
