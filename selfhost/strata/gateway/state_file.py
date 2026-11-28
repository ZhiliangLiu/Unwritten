import json
import os
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

STATE_PATH = Path("/tmp/unwritten-strata.state")


def write(
    path: Path,
    *,
    ready: bool,
    reason: str | None,
    in_flight: int,
    last_activity_at: float | None,
) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(
        {
            "ready": ready,
            "notReadyReason": reason,
            "inFlight": in_flight,
            "lastActivityAt": last_activity_at,
        },
        separators=(",", ":"),
    )
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            stream.write(payload)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


@dataclass
class GatewayState:
    path: Path = STATE_PATH
    ready: bool = False
    reason: str | None = "starting"
    in_flight: int = 0
    last_activity_at: float | None = None
    selftest_passed: bool = False
    selftest_finished: bool = False
    failure_reason: str | None = None

    def write(self) -> None:
        write(
            self.path,
            ready=self.ready,
            reason=self.reason,
            in_flight=self.in_flight,
            last_activity_at=self.last_activity_at,
        )

    def set_ready(self, ready: bool, reason: str | None = None) -> None:
        if self.ready == ready and self.reason == reason:
            return
        self.ready = ready
        self.reason = reason
        self.write()

    def set_unready(self, reason: str) -> None:
        self.set_ready(False, reason)

    def mark_selftest_passed(self) -> None:
        self.selftest_passed = True
        self.selftest_finished = True
        self.failure_reason = None
        self.set_ready(True, None)

    def mark_selftest_failed(self, reason: str) -> None:
        self.selftest_finished = True
        self.failure_reason = reason
        if self.reason == "engine_down":
            return
        self.set_ready(False, reason)

    def begin_request(self) -> None:
        self.in_flight += 1
        self.last_activity_at = time.time()
        self.write()

    def end_request(self) -> None:
        self.in_flight = max(0, self.in_flight - 1)
        self.last_activity_at = time.time()
        self.write()
