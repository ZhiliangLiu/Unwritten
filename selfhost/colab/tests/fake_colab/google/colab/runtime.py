_unassign_calls = 0


def reset() -> None:
    global _unassign_calls
    _unassign_calls = 0


def unassign() -> None:
    global _unassign_calls
    _unassign_calls += 1


def unassign_calls() -> int:
    return _unassign_calls
