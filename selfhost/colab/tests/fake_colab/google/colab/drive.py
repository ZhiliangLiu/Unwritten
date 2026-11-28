import shutil
from pathlib import Path

_mount: Path | None = None
_remove_mount = True
_unmount_calls = 0


def reset(mount: Path, *, remove: bool = True) -> None:
    global _mount, _remove_mount, _unmount_calls
    _mount = mount
    _remove_mount = remove
    _unmount_calls = 0


def flush_and_unmount() -> None:
    global _unmount_calls
    _unmount_calls += 1
    if _remove_mount and _mount is not None:
        shutil.rmtree(_mount, ignore_errors=True)


def unmount_calls() -> int:
    return _unmount_calls
