import json

PHASES = frozenset({"copying", "preparing", "models", "tailscale", "starting", "serving", "exiting"})
EXTRA_KEYS = frozenset({"reason", "step"})


def emit(phase: str, **extra: str) -> None:
    if phase not in PHASES:
        raise ValueError(f"unknown phase: {phase}")
    for key, value in extra.items():
        if key not in EXTRA_KEYS or not isinstance(value, str):
            raise ValueError(f"invalid status field: {key}")
    print(f"unwritten-host {json.dumps({'phase': phase, **extra}, ensure_ascii=True)}", flush=True)
