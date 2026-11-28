import subprocess
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .paths import Paths


@dataclass(frozen=True)
class HostedService:
    name: str
    hostname: str
    tag: str
    token_secret: str
    authkey_secret: str
    min_vram_gib: float
    min_ram_gib: float | None
    port: int
    models_lock: Path | None
    prepare: Callable[[Paths], None]
    start: Callable[[Paths, str], list[subprocess.Popen]]
