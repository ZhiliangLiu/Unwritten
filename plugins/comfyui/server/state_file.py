import json
import os
import tempfile
from pathlib import Path


def write(
    path: Path,
    *,
    ready: bool,
    reason: str | None,
    in_flight: int,
    last_activity_at: float | None,
) -> None:
    payload = {
        "ready": ready,
        "notReadyReason": reason,
        "inFlight": in_flight,
        "lastActivityAt": last_activity_at,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=f"{path.name}.")
    try:
        with os.fdopen(descriptor, "w") as file:
            json.dump(payload, file)
        os.replace(temporary, path)
    except BaseException:
        Path(temporary).unlink(missing_ok=True)
        raise
