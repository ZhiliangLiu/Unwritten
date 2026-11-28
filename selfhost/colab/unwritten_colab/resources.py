import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .service import HostedService

DISK_HEADROOM_GIB = 20


class ResourceError(Exception):
    pass


@dataclass(frozen=True)
class Readings:
    vram_gib: float
    ram_gib: float
    disk_gib: float


def read_vram_gib() -> float:
    executable = shutil.which("nvidia-smi")
    if executable is None:
        raise ResourceError("nvidia-smi not found")
    result = subprocess.run(
        [executable, "--query-gpu=memory.total", "--format=csv,noheader,nounits"],
        check=True,
        capture_output=True,
        text=True,
        shell=False,
    )
    return float(result.stdout.splitlines()[0]) / 1024


def read_ram_gib() -> float:
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemTotal:"):
            return int(line.split()[1]) / 1024**2
    raise ResourceError("MemTotal not found")


def free_disk_gib(path: Path) -> float:
    return shutil.disk_usage(path).free / 2**30


def check_resources(
    service: HostedService,
    models_total_bytes: int,
    readings: Readings,
) -> list[tuple[str, float, float]]:
    shortages: list[tuple[str, float, float]] = []
    if readings.vram_gib < service.min_vram_gib:
        shortages.append(("vram", service.min_vram_gib, readings.vram_gib))
    if service.min_ram_gib is not None and readings.ram_gib < service.min_ram_gib:
        shortages.append(("ram", service.min_ram_gib, readings.ram_gib))
    needed_disk_gib = models_total_bytes / 2**30 + DISK_HEADROOM_GIB
    if readings.disk_gib < needed_disk_gib:
        shortages.append(("disk", needed_disk_gib, readings.disk_gib))
    return shortages
