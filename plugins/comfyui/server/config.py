import os
import sys
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import NoReturn

TOKEN_MIN_LENGTH = 32
DEFAULT_PORT = 8190
DEFAULT_COMFY_URL = "http://127.0.0.1:8188"
DEFAULT_STATE_FILE = Path("/tmp/unwritten-comfyui.state")
RESULT_RETENTION_S = 600
WEBP_QUALITY = 92
MAX_REFERENCE_EDGE = 4096
POLL_INTERVAL_S = 1


@dataclass(frozen=True)
class Config:
    token: str
    port: int
    comfy_url: str
    input_dir: Path
    output_dir: Path
    gpu_name: str | None
    state_file: Path


def _exit(message: str) -> NoReturn:
    print(message, file=sys.stderr)
    sys.exit(1)


def _required(env: Mapping[str, str], name: str) -> str:
    value = env.get(name)
    if not value:
        _exit(f"{name} is required")
    return value


def load_config(environ: Mapping[str, str] | None = None) -> Config:
    env = os.environ if environ is None else environ
    token = env.get("UNWRITTEN_IMAGE_TOKEN", "")
    if len(token) < TOKEN_MIN_LENGTH:
        _exit("token too short")
    try:
        port = int(env.get("UNWRITTEN_IMAGE_PORT", str(DEFAULT_PORT)))
    except ValueError:
        _exit("UNWRITTEN_IMAGE_PORT must be an integer")
    return Config(
        token=token,
        port=port,
        comfy_url=env.get("COMFY_URL", DEFAULT_COMFY_URL).rstrip("/"),
        input_dir=Path(_required(env, "COMFY_INPUT_DIR")),
        output_dir=Path(_required(env, "COMFY_OUTPUT_DIR")),
        gpu_name=env.get("UNWRITTEN_GPU_NAME") or None,
        state_file=Path(env.get("UNWRITTEN_STATE_FILE", str(DEFAULT_STATE_FILE))),
    )
