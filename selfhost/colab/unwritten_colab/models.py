import hashlib
import json
import shutil
import urllib.request
from collections.abc import Callable
from pathlib import Path
from typing import Any

DOWNLOAD_ROOT = "https://huggingface.co"
CHUNK_BYTES = 8 * 1024 * 1024


class ModelError(Exception):
    def __init__(self, dest: str) -> None:
        self.dest = dest
        super().__init__(dest)


def load_lock(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text())


def models_total_bytes(lock: dict[str, Any]) -> int:
    total = sum(int(entry["size"]) for entry in lock["files"])
    for artifact in lock.get("artifacts", []):
        total += int(artifact["source"]["bytes"])
        total += sum(int(entry["size"]) for entry in artifact["files"])
    return total


def _verified_path(path: Path) -> Path:
    return path.with_name(path.name + ".verified.json")


def _marker_matches(path: Path) -> bool:
    try:
        marker = json.loads(_verified_path(path).read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return False
    if not isinstance(marker, dict):
        return False
    stat = path.stat()
    return marker.get("size") == stat.st_size and marker.get("mtime_ns") == stat.st_mtime_ns


def _write_marker(path: Path) -> None:
    stat = path.stat()
    _verified_path(path).write_text(json.dumps({"size": stat.st_size, "mtime_ns": stat.st_mtime_ns}))


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(CHUNK_BYTES), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download(entry: dict[str, Any], local_path: Path, opener: Callable[..., Any]) -> None:
    url = f"{DOWNLOAD_ROOT}/{entry['repo']}/resolve/{entry['commit']}/{entry['path']}"
    part = local_path.with_name(local_path.name + ".part")
    part.parent.mkdir(parents=True, exist_ok=True)
    digest = hashlib.sha256()
    size = 0
    try:
        with opener(url) as response, part.open("wb") as file:
            for chunk in iter(lambda: response.read(CHUNK_BYTES), b""):
                file.write(chunk)
                digest.update(chunk)
                size += len(chunk)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    if size != int(entry["size"]) or digest.hexdigest() != entry["sha256"]:
        part.unlink(missing_ok=True)
        raise ModelError(entry["dest"])
    part.replace(local_path)


def ensure_models(
    lock: dict[str, Any],
    drive_models: Path,
    local_models: Path,
    opener: Callable[..., Any] = urllib.request.urlopen,
) -> None:
    for entry in lock["files"]:
        dest = entry["dest"]
        drive_path = drive_models / dest
        local_path = local_models / dest
        if drive_path.is_file() and not _marker_matches(drive_path):
            if _sha256(drive_path) == entry["sha256"]:
                _write_marker(drive_path)
            else:
                drive_path.unlink()
        if drive_path.is_file():
            if not local_path.is_file():
                local_path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(drive_path, local_path)
            continue
        _download(entry, local_path, opener)
        drive_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(local_path, drive_path)
        _write_marker(drive_path)
