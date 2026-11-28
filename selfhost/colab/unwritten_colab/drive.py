import shutil
from pathlib import Path

DEFAULT_MOUNT = Path("/content/drive")


class DriveError(Exception):
    pass


def find_drive_root(mount: Path = DEFAULT_MOUNT) -> Path | None:
    for name in ("MyDrive", "My Drive"):
        base = mount / name
        if base.is_dir():
            return base / "unwritten"
    return None


def is_mounted(mount: Path = DEFAULT_MOUNT) -> bool:
    return find_drive_root(mount) is not None


def copy_tree(src: Path, dst: Path) -> None:
    shutil.copytree(src, dst, dirs_exist_ok=True)


def unmount(drive_module, mount: Path = DEFAULT_MOUNT) -> None:
    drive_module.flush_and_unmount()
    if is_mounted(mount):
        raise DriveError("still mounted")
