from dataclasses import dataclass
from pathlib import Path

DEFAULT_LOCAL_ROOT = Path("/content/unwritten")
STATE_ROOT = Path("/tmp")


@dataclass(frozen=True)
class Paths:
    name: str
    local_root: Path
    service_dir: Path
    models_dir: Path
    tailscale_dir: Path
    drive_root: Path | None
    state_file: Path

    @classmethod
    def for_service(
        cls,
        name: str,
        drive_root: Path | None,
        *,
        local_root: Path = DEFAULT_LOCAL_ROOT,
        state_file: Path | None = None,
    ) -> "Paths":
        service_root = local_root / name
        return cls(
            name=name,
            local_root=local_root,
            service_dir=service_root / "code",
            models_dir=service_root / "models",
            tailscale_dir=service_root / "tailscale",
            drive_root=drive_root,
            state_file=state_file if state_file is not None else STATE_ROOT / f"unwritten-{name}.state",
        )
