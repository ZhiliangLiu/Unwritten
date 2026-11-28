import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from . import drive as drive_module
from . import models as models_module
from . import resources as resources_module
from . import secrets as secrets_module
from . import state as state_module
from . import status_line as status_line_module
from . import tailscale as tailscale_module
from . import watchdog as watchdog_module
from .paths import Paths
from .resources import Readings, ResourceError, check_resources
from .secrets import SecretProblem
from .service import HostedService

START_TIMEOUT_SECONDS = 60


class HostError(Exception):
    pass


@dataclass(frozen=True)
class RunDeps:
    drive: Any
    userdata: Any
    runtime: Any
    paths_for_service: Callable[..., Paths] = Paths.for_service
    find_drive_root: Callable[..., Path | None] = drive_module.find_drive_root
    copy_tree: Callable[[Path, Path], None] = drive_module.copy_tree
    unmount: Callable[..., None] = drive_module.unmount
    read_notebook_secret: Callable[[str, Any], str] = secrets_module.read_notebook_secret
    read_launch_file: Callable[[Path], dict[str, Any]] = secrets_module.read_launch_file
    read_vram_gib: Callable[[], float] = resources_module.read_vram_gib
    read_ram_gib: Callable[[], float] = resources_module.read_ram_gib
    free_disk_gib: Callable[[Path], float] = resources_module.free_disk_gib
    load_lock: Callable[[Path], dict[str, Any]] = models_module.load_lock
    models_total_bytes: Callable[[dict[str, Any]], int] = models_module.models_total_bytes
    ensure_models: Callable[..., None] = models_module.ensure_models
    install: Callable[[], None] = tailscale_module.install
    start_tailscaled: Callable[[Path], Any] = tailscale_module.start_tailscaled
    has_identity: Callable[[Path], bool] = tailscale_module.has_identity
    up: Callable[[str, str, str | None], None] = tailscale_module.up
    serve: Callable[[int], None] = tailscale_module.serve
    dns_name: Callable[[], str] = tailscale_module.dns_name
    read_state: Callable[[Path], state_module.ServiceState | None] = state_module.read_state
    watch: Callable[..., str] = watchdog_module.watch
    sleep: Callable[[float], None] = time.sleep
    clock: Callable[[], float] = time.monotonic


def _colab_deps() -> RunDeps:
    from google.colab import drive, runtime, userdata

    return RunDeps(drive=drive, userdata=userdata, runtime=runtime)


def _process_name(process: Any) -> str:
    args = getattr(process, "args", None)
    if isinstance(args, (list, tuple)) and args:
        first = Path(str(args[0])).name
        if first.startswith("python") and len(args) > 1:
            return Path(str(args[1])).name
        return first
    if args:
        return Path(str(args)).name
    return "process"


def _launch_values(launch: dict[str, Any]) -> tuple[str, str | None, int]:
    token = launch["token"]
    authkey = launch["tailscaleAuthKey"]
    idle_minutes = launch["idleMinutes"]
    if not isinstance(token, str) or not token:
        raise SecretProblem("launch.json", "missing")
    if authkey is not None and not isinstance(authkey, str):
        raise SecretProblem("launch.json", "missing")
    if not isinstance(idle_minutes, int) or isinstance(idle_minutes, bool):
        raise SecretProblem("launch.json", "missing")
    return token, authkey, idle_minutes


def _wait_for_state(deps: RunDeps, state_path: Path) -> None:
    for _ in range(START_TIMEOUT_SECONDS):
        if deps.read_state(state_path) is not None:
            return
        deps.sleep(1)
    raise HostError("state file not created")


def run(
    service: HostedService,
    *,
    mode: Literal["notebook", "launcher"],
    idle_minutes: int,
    deps: RunDeps | None = None,
) -> None:
    deps = deps if deps is not None else _colab_deps()
    status = status_line_module.emit if mode == "launcher" else None

    def emit(phase: str, **extra: str) -> None:
        if status is not None:
            status(phase, **extra)

    step = "copying"
    processes: list[tuple[str, Any]] = []
    try:
        emit("copying")
        drive_root = deps.find_drive_root()
        if drive_root is None:
            raise HostError("drive not mounted")
        paths = deps.paths_for_service(service.name, drive_root)
        if mode == "notebook":
            deps.copy_tree(drive_root / "colab", paths.local_root / "colab")
            deps.copy_tree(drive_root / service.name / "code", paths.service_dir)
        drive_tailscale = drive_root / service.name / "tailscale"
        if drive_tailscale.exists():
            deps.copy_tree(drive_tailscale, paths.tailscale_dir)

        step = "secrets"
        identity = deps.has_identity(paths.tailscale_dir)
        if mode == "launcher":
            token, authkey, idle = _launch_values(deps.read_launch_file(paths.local_root / "launch.json"))
            if identity:
                authkey = None
        else:
            token = deps.read_notebook_secret(service.token_secret, deps.userdata)
            authkey = None if identity else deps.read_notebook_secret(service.authkey_secret, deps.userdata)
            idle = idle_minutes

        step = "resources"
        lock = deps.load_lock(service.models_lock) if service.models_lock is not None else {"files": []}
        models_bytes = deps.models_total_bytes(lock)
        try:
            vram_gib = deps.read_vram_gib()
        except ResourceError:
            vram_gib = 0.0
        readings = Readings(
            vram_gib=vram_gib, ram_gib=deps.read_ram_gib(), disk_gib=deps.free_disk_gib(paths.local_root)
        )
        shortages = check_resources(service, models_bytes, readings)
        if shortages:
            for item, needed, actual in shortages:
                print(f"insufficient {item}: need {needed:.1f} GiB, have {actual:.1f} GiB")
            raise HostError("insufficient resources")

        step = "preparing"
        emit("preparing")
        service.prepare(paths)
        step = "models"
        emit("models")
        if service.models_lock is not None:
            deps.ensure_models(lock, drive_root / service.name / "models", paths.models_dir)

        step = "tailscale"
        emit("tailscale")
        deps.install()
        tailscaled = deps.start_tailscaled(paths.tailscale_dir)
        processes.append(("tailscaled", tailscaled))
        deps.up(service.hostname, service.tag, authkey)
        deps.copy_tree(paths.tailscale_dir, drive_tailscale)

        step = "unmount"
        deps.unmount(deps.drive)

        step = "starting"
        emit("starting")
        for process in service.start(paths, token):
            processes.append((_process_name(process), process))
        _wait_for_state(deps, paths.state_file)

        step = "serving"
        deps.serve(service.port)
        print(deps.dns_name())
        emit("serving")

        deps.watch(
            processes=processes,
            state_path=paths.state_file,
            idle_minutes=idle,
            clock=deps.clock,
            sleep=deps.sleep,
            unassign=deps.runtime.unassign,
            log=print,
            status=status,
        )
    except (
        HostError,
        tailscale_module.TailscaleError,
        models_module.ModelError,
        drive_module.DriveError,
        SecretProblem,
    ):
        if status is not None:
            status("exiting", reason="error", step=step)
        raise
