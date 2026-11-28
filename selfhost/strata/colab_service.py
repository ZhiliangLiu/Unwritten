import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from unwritten_colab import HostedService, Paths
from unwritten_colab.run import HostError

STRATA_PORT = 8080
GATEWAY_PORT = 8191
CONTEXT_TOKENS = 65536
DATA_DIR_NAME = "strata-data"
MTP_ARTIFACT = "mtp-q2_0"
AUTH_ENV = "UNWRITTEN_LLM_TOKEN"
AUTHKEY_ENV = "TS_AUTHKEY_LLM"
HASH_CHUNK = 8 * 1024 * 1024


def _lock() -> dict:
    return json.loads((Path(__file__).parent / "models.lock.json").read_text(encoding="utf-8"))


def _artifact() -> dict:
    for artifact in _lock().get("artifacts", []):
        if artifact.get("name") == MTP_ARTIFACT:
            return artifact
    raise RuntimeError(f"{MTP_ARTIFACT} is missing from models.lock.json")


def _artifact_files(artifact: dict) -> dict[str, dict]:
    return {entry["path"]: entry for entry in artifact["files"]}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(HASH_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _marker(path: Path) -> Path:
    return path.with_name(path.name + ".verified.json")


def _drop(path: Path) -> None:
    path.unlink(missing_ok=True)
    _marker(path).unlink(missing_ok=True)


def _write_marker(path: Path, digest: str) -> None:
    stat = path.stat()
    _marker(path).write_text(
        json.dumps({"size": stat.st_size, "mtime_ns": stat.st_mtime_ns, "sha256": digest}),
        encoding="utf-8",
    )


def _verify(path: Path, entry: dict) -> bool:
    if not path.is_file():
        return False
    stat = path.stat()
    expected_size = entry.get("size")
    expected_sha = entry.get("sha256")
    if expected_size is not None and stat.st_size != expected_size:
        _drop(path)
        return False
    try:
        marker = json.loads(_marker(path).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        marker = None
    if (
        isinstance(marker, dict)
        and marker.get("size") == stat.st_size
        and marker.get("mtime_ns") == stat.st_mtime_ns
        and (expected_sha is None or marker.get("sha256") == expected_sha)
    ):
        return True
    digest = _sha256(path)
    if expected_sha is not None and digest != expected_sha:
        _drop(path)
        return False
    _write_marker(path, digest)
    return True


def _files_ok(root: Path, artifact: dict) -> bool:
    return all(_verify(root / relative, entry) for relative, entry in _artifact_files(artifact).items())


def _copy_files(source: Path, destination: Path, artifact: dict) -> None:
    for relative in _artifact_files(artifact):
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source / relative, target)


def _cache_root(paths: Paths) -> Path | None:
    if paths.drive_root is None:
        return None
    return paths.drive_root / paths.name / "mtp"


def _local_root(paths: Paths) -> Path:
    return paths.local_root / DATA_DIR_NAME / "mtp"


def _replace_local(source: Path, destination: Path) -> None:
    if destination.exists():
        shutil.rmtree(destination)
    source.rename(destination)


def _restore(paths: Paths, artifact: dict) -> bool:
    cache = _cache_root(paths)
    if cache is None or not _files_ok(cache, artifact):
        return False
    temporary = _local_root(paths).with_name("mtp.restore")
    shutil.rmtree(temporary, ignore_errors=True)
    temporary.mkdir(parents=True)
    try:
        _copy_files(cache, temporary, artifact)
        if not _files_ok(temporary, artifact):
            return False
        _replace_local(temporary, _local_root(paths))
        return True
    finally:
        if temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)


def _cache_local(paths: Paths, artifact: dict) -> None:
    cache = _cache_root(paths)
    local = _local_root(paths)
    if cache is None or not _files_ok(local, artifact):
        return
    for relative in _artifact_files(artifact):
        source = local / relative
        target = cache / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, target)
        _write_marker(target, _sha256(target))


def _strata_root() -> Path:
    candidates = [os.environ.get("STRATA_INSTALL_DIR"), shutil.which("strata")]
    data_dir = os.environ.get("STRATA_DATA_DIR")
    if data_dir:
        candidates.append(str(Path(data_dir) / "terminal" / "current"))
    bin_dir = os.environ.get("STRATA_BIN_DIR")
    if bin_dir:
        candidates.append(str(Path(bin_dir) / "strata"))
    candidates.append(str(Path.home() / ".local" / "share" / "strata" / "terminal" / "current"))
    candidates.append(str(Path.home() / ".local" / "bin" / "strata"))
    for raw in candidates:
        if not raw:
            continue
        path = Path(raw)
        roots = [path] if path.is_dir() else [path.resolve().parent.parent, path.resolve().parent]
        for root in roots:
            if (root / "tools" / "mtp_fetch.py").is_file() and (root / "data" / "draft_vocab.bin").is_file():
                return root
    raise RuntimeError("the installed Strata tools were not found")


def _strata_python(root: Path) -> Path:
    for raw in (
        os.environ.get("STRATA_PYTHON"),
        root / "python" / "bin" / "python3",
        root / "python" / "bin" / "python",
    ):
        if raw is not None and Path(raw).is_file():
            return Path(raw)
    return Path(sys.executable)


def _run(command: list[str], root: Path) -> None:
    subprocess.run(command, check=True, cwd=str(root))


def build_mtp(paths: Paths, artifact: dict) -> None:
    root = _strata_root()
    python = str(_strata_python(root))
    local = _local_root(paths)
    temporary = local.with_name("mtp-build")
    shutil.rmtree(temporary, ignore_errors=True)
    temporary.mkdir(parents=True)
    try:
        _run([python, str(root / "tools" / "mtp_fetch.py"), "fetch", "--out", str(temporary)], root)
        packed = temporary / "mtp-q2_0.gguf"
        _run(
            [
                python,
                str(root / "tools" / "mtp_pack.py"),
                "--src",
                str(temporary),
                "--experts",
                "q2_0",
                "--out",
                str(packed),
            ],
            root,
        )
        runtime = temporary / "rt"
        _run(
            [
                python,
                str(root / "tools" / "mtp_rt.py"),
                "--gguf",
                str(packed),
                "--out",
                str(runtime),
            ],
            root,
        )
        shutil.copyfile(root / "data" / "draft_vocab.bin", runtime / "draft_vocab.bin")
        shutil.rmtree(temporary / "tensors", ignore_errors=True)
        for name in (
            "mtp-manifest.json",
            "mtp-inventory.json",
            "mtp-inventory.md",
            ".mtp_fetch.lock",
            "mtp-q2_0.gguf.report.json",
        ):
            (temporary / name).unlink(missing_ok=True)
        if not _files_ok(temporary, artifact):
            raise RuntimeError("the built MTP layer does not match the pinned artifact")
        _replace_local(temporary, local)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def sync_mtp(paths: Paths, artifact: dict | None = None, *, build=build_mtp) -> bool:
    artifact = _artifact() if artifact is None else artifact
    local = _local_root(paths)
    try:
        if _restore(paths, artifact):
            return True
        if _files_ok(local, artifact):
            _cache_local(paths, artifact)
            return True
        build(paths, artifact)
        if not _files_ok(local, artifact):
            raise RuntimeError("the local MTP layer is incomplete")
        _cache_local(paths, artifact)
        return True
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        if not _files_ok(local, artifact):
            shutil.rmtree(local, ignore_errors=True)
        print(f"MTP cache unavailable: {error}", file=sys.stderr)
        return False


def prepare(paths: Paths) -> None:
    root = Path(__file__).parent
    curl = shutil.which("curl") or "/usr/bin/curl"
    shell = shutil.which("sh") or "/bin/sh"
    subprocess.run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--require-hashes",
            "-r",
            str(root / "requirements.txt"),
        ],
        check=True,
    )
    lock = json.loads((root / "strata.lock.json").read_text(encoding="utf-8"))
    feed = lock["feed"]
    with tempfile.TemporaryDirectory() as directory:
        installer = Path(directory) / "install.sh"
        subprocess.run(
            [
                curl,
                "-fsSL",
                "--connect-timeout",
                "15",
                "--max-time",
                "120",
                "-o",
                str(installer),
                f"{feed}/install.sh",
            ],
            check=True,
        )
        subprocess.run([shell, str(installer)], check=True, env={**os.environ, "STRATA_FEED": feed})
    sync_mtp(paths)


def start(paths: Paths, token: str) -> list[subprocess.Popen]:
    internal_key = secrets.token_urlsafe(32)
    data_dir = paths.local_root / DATA_DIR_NAME
    data_dir.mkdir(parents=True, exist_ok=True)
    strata = shutil.which("strata") or str(Path.home() / ".local" / "bin" / "strata")
    result = subprocess.run(
        [
            strata,
            "launch",
            "--family",
            "qwen",
            "--model",
            "q2_0",
            "--model-path",
            str(paths.models_dir),
            "--data-dir",
            str(data_dir),
            "--access",
            "local",
            "--port",
            str(STRATA_PORT),
            "--context",
            str(CONTEXT_TOKENS),
            "--parallel",
            "1",
            "--vision",
            "off",
            "--api-key-env",
            "STRATA_INTERNAL_KEY",
            "--yes",
            "--no-tui",
        ],
        capture_output=True,
        text=True,
        env={
            **os.environ,
            "STRATA_UPDATE_CHECK": "0",
            "STRATA_INTERNAL_KEY": internal_key,
        },
    )
    if result.returncode != 0:
        output = (result.stdout or "") + (result.stderr or "")
        print(output.replace(internal_key, "<redacted>"), file=sys.stderr)
        raise HostError("strata launch failed")
    process = subprocess.Popen(
        [sys.executable, "-m", "gateway"],
        cwd=str(paths.service_dir),
        env={
            **os.environ,
            "UNWRITTEN_LLM_TOKEN": token,
            "STRATA_INTERNAL_KEY": internal_key,
            "UNWRITTEN_LLM_PORT": str(GATEWAY_PORT),
            "STRATA_URL": f"http://127.0.0.1:{STRATA_PORT}",
        },
    )
    return [process]


SERVICE = HostedService(
    name="strata",
    hostname="unwritten-llm",
    tag="tag:unwritten-llm",
    token_secret=AUTH_ENV,
    authkey_secret=AUTHKEY_ENV,
    min_vram_gib=12,
    min_ram_gib=48,
    port=GATEWAY_PORT,
    models_lock=Path(__file__).parent / "models.lock.json",
    prepare=prepare,
    start=start,
)
