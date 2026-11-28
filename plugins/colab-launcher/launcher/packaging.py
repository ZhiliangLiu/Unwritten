import json
import os
import tarfile
import tempfile
from pathlib import Path

EXCLUDED_DIR_NAMES = frozenset({"tests", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache"})
EXCLUDED_SUFFIXES = frozenset({".ipynb"})
LAUNCH_MODE = 0o600


def _included(path: Path, root: Path) -> bool:
    if path.suffix in EXCLUDED_SUFFIXES:
        return False
    return not any(part in EXCLUDED_DIR_NAMES for part in path.relative_to(root).parts)


def _add_tree(archive: tarfile.TarFile, root: Path, prefix: str) -> None:
    for path in sorted(root.rglob("*")):
        if path.is_file() and _included(path, root):
            archive.add(path, arcname=str(Path(prefix) / path.relative_to(root)))


def pack(host_dir: Path, service_dir: Path) -> Path:
    directory = Path(tempfile.mkdtemp(prefix="unwritten-launcher-"))
    archive_path = directory / "upload.tar"
    with tarfile.open(archive_path, "w") as archive:
        _add_tree(archive, Path(host_dir), "colab")
        _add_tree(archive, Path(service_dir), f"{Path(service_dir).name}/code")
    return archive_path


def write_launch_file(token: str, authkey: str | None, idle_minutes: int) -> Path:
    directory = Path(tempfile.mkdtemp(prefix="unwritten-launch-"))
    path = directory / "launch.json"
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, LAUNCH_MODE)
    with os.fdopen(descriptor, "w") as handle:
        json.dump({"token": token, "tailscaleAuthKey": authkey, "idleMinutes": idle_minutes}, handle)
    path.chmod(LAUNCH_MODE)
    return path
