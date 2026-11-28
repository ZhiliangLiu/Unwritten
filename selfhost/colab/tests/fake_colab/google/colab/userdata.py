from collections.abc import Mapping

_values: dict[str, str | None] = {}
_requested: list[str] = []


class SecretNotFoundError(Exception):
    pass


class NotebookAccessError(Exception):
    pass


def reset(values: Mapping[str, str | None]) -> None:
    _values.clear()
    _values.update(values)
    _requested.clear()


def get(name: str) -> str:
    _requested.append(name)
    if name not in _values:
        raise SecretNotFoundError(name)
    value = _values[name]
    if value is None:
        raise NotebookAccessError(name)
    return value


def requested() -> list[str]:
    return list(_requested)
