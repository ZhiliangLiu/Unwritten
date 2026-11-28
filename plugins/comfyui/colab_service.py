import os
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

from unwritten_colab import HostedService, Paths

PLUGIN_DIR = Path(__file__).resolve().parent
COMFY_DIR = Path("/content/ComfyUI")
COMFY_PORT = 8188
COMFY_START_TIMEOUT_S = 300
PORT = 8190
LOCK_FILE = PLUGIN_DIR / "comfyui.lock"


def _lock_value(name: str) -> str:
    for line in LOCK_FILE.read_text().splitlines():
        key, separator, value = line.partition("=")
        if separator and key.strip() == name:
            return value.strip()
    raise RuntimeError(f"{name} is missing from comfyui.lock")


def _run(command: list[str]) -> None:
    subprocess.run(command, check=True)


def prepare(paths: Paths) -> None:
    if not (COMFY_DIR / ".git").exists():
        _run(["git", "clone", "--filter=blob:none", _lock_value("repo"), str(COMFY_DIR)])
    _run(["git", "-C", str(COMFY_DIR), "checkout", _lock_value("commit")])
    _run([sys.executable, "-m", "pip", "install", "-r", str(COMFY_DIR / "requirements.txt")])
    _run(
        [
            sys.executable,
            "-m",
            "pip",
            "install",
            "--require-hashes",
            "-r",
            str(PLUGIN_DIR / "requirements.txt"),
        ]
    )
    extra_model_paths = (
        "unwritten:\n"
        f"  base_path: {paths.models_dir}\n"
        "  diffusion_models: diffusion_models\n"
        "  text_encoders: text_encoders\n"
        "  vae: vae\n"
        "  loras: loras\n"
    )
    (COMFY_DIR / "extra_model_paths.yaml").write_text(extra_model_paths)


def _wait_for_comfy(process: subprocess.Popen) -> None:
    deadline = time.monotonic() + COMFY_START_TIMEOUT_S
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("ComfyUI exited before it was ready")
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{COMFY_PORT}/system_stats", timeout=2):
                return
        except OSError:
            time.sleep(1)
    raise RuntimeError("ComfyUI did not become ready")


def start(paths: Paths, token: str) -> list[subprocess.Popen]:
    service_root = paths.local_root / paths.name
    input_dir = service_root / "input"
    output_dir = service_root / "output"
    input_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)
    comfy = subprocess.Popen(
        [
            sys.executable,
            "-u",
            "main.py",
            "--listen",
            "127.0.0.1",
            "--port",
            str(COMFY_PORT),
            "--disable-metadata",
            "--disable-auto-launch",
            "--input-directory",
            str(input_dir),
            "--output-directory",
            str(output_dir),
        ],
        cwd=COMFY_DIR,
    )
    try:
        _wait_for_comfy(comfy)
    except RuntimeError:
        comfy.terminate()
        raise
    environment = os.environ.copy()
    environment.update(
        {
            "UNWRITTEN_IMAGE_TOKEN": token,
            "UNWRITTEN_IMAGE_PORT": str(PORT),
            "COMFY_URL": f"http://127.0.0.1:{COMFY_PORT}",
            "COMFY_INPUT_DIR": str(input_dir),
            "COMFY_OUTPUT_DIR": str(output_dir),
        }
    )
    try:
        wrapper = subprocess.Popen([sys.executable, "-m", "server"], cwd=paths.service_dir, env=environment)
    except OSError:
        comfy.terminate()
        raise
    return [comfy, wrapper]


SERVICE = HostedService(
    name="comfyui",
    hostname="unwritten-image",
    tag="tag:unwritten-image",
    token_secret="UNWRITTEN_IMAGE_TOKEN",
    authkey_secret="TS_AUTHKEY_IMAGE",
    min_vram_gib=24,
    min_ram_gib=None,
    port=PORT,
    models_lock=PLUGIN_DIR / "models.lock.json",
    prepare=prepare,
    start=start,
)
