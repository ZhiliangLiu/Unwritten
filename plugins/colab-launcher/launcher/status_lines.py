import json

PREFIX = "unwritten-host "


def parse(line: str) -> dict[str, str] | None:
    if not isinstance(line, str) or not line.startswith(PREFIX):
        return None
    try:
        value = json.loads(line[len(PREFIX) :])
    except ValueError:
        return None
    if not isinstance(value, dict):
        return None
    phase = value.get("phase")
    if not isinstance(phase, str):
        return None
    parsed = {"phase": phase}
    for key in ("reason", "step"):
        item = value.get(key)
        if isinstance(item, str):
            parsed[key] = item
    return parsed
