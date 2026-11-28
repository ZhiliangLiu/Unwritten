import json
import os
import subprocess
import tempfile
import time
from pathlib import Path

SOCKET_PATH = Path("/tmp/tailscaled.sock")
WAIT_TIMEOUT_SECONDS = 30
WAIT_INTERVAL_SECONDS = 0.1


class TailscaleError(Exception):
    def __init__(self, command: str) -> None:
        self.command = command
        super().__init__(command)


def _run(command: list[str], name: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(command, check=True, capture_output=True, text=True, shell=False)
    except (OSError, subprocess.CalledProcessError):
        raise TailscaleError(name) from None


def install() -> None:
    _run(["sh", "-c", "curl -fsSL https://tailscale.com/install.sh | sh"], "install")


def start_tailscaled(statedir: Path) -> subprocess.Popen[bytes]:
    SOCKET_PATH.unlink(missing_ok=True)
    try:
        process = subprocess.Popen(
            [
                "tailscaled",
                "--tun=userspace-networking",
                f"--statedir={statedir}",
                f"--socket={SOCKET_PATH}",
            ],
            shell=False,
        )
    except OSError:
        raise TailscaleError("tailscaled") from None
    deadline = time.monotonic() + WAIT_TIMEOUT_SECONDS
    while not SOCKET_PATH.exists():
        if time.monotonic() >= deadline:
            process.terminate()
            raise TailscaleError("tailscaled")
        time.sleep(WAIT_INTERVAL_SECONDS)
    return process


def has_identity(statedir: Path) -> bool:
    state_path = statedir / "tailscaled.state"
    return state_path.is_file() and state_path.stat().st_size > 0


def _write_authkey(value: str) -> Path:
    handle = tempfile.NamedTemporaryFile("w", prefix="unwritten-tailscale-", suffix=".authkey", delete=False)
    try:
        os.chmod(handle.name, 0o600)
        handle.write(value)
        handle.flush()
    finally:
        handle.close()
    return Path(handle.name)


def up(hostname: str, tag: str, authkey: str | None) -> None:
    command = [
        "tailscale",
        f"--socket={SOCKET_PATH}",
        "up",
        f"--hostname={hostname}",
        f"--advertise-tags={tag}",
    ]
    authkey_file: Path | None = None
    if authkey is not None:
        authkey_file = _write_authkey(authkey)
        command.append(f"--auth-key=file:{authkey_file}")
    try:
        _run(command, "up")
    finally:
        if authkey_file is not None:
            authkey_file.unlink(missing_ok=True)


def serve(port: int) -> None:
    _run(
        [
            "tailscale",
            f"--socket={SOCKET_PATH}",
            "serve",
            "--bg",
            "--https=443",
            f"http://127.0.0.1:{port}",
        ],
        "serve",
    )


def dns_name() -> str:
    result = _run(["tailscale", f"--socket={SOCKET_PATH}", "status", "--json"], "status")
    try:
        dns = json.loads(result.stdout)["Self"]["DNSName"].rstrip(".")
    except (json.JSONDecodeError, KeyError, TypeError):
        raise TailscaleError("status") from None
    return f"https://{dns}"
