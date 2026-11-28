import json
import os
import stat
from dataclasses import dataclass
from pathlib import Path

CONFIG_ENV = "UNWRITTEN_LAUNCHER_CONFIG"
DEFAULT_CONFIG_PATH = Path.home() / ".config" / "unwritten" / "colab-launcher.json"
DEFAULT_PORT = 8290
LOOPBACK = "127.0.0.1"
MIN_TOKEN_LENGTH = 32
CONFIG_MODE = 0o600


class ConfigError(Exception):
    pass


@dataclass(frozen=True)
class ServiceConfig:
    name: str
    code: Path
    session: str
    gpu: str
    high_mem: bool
    token: str
    tailscale_auth_key: str | None


@dataclass(frozen=True)
class Config:
    port: int
    listen: str
    token: str
    host_dir: Path
    service: ServiceConfig | None
    problem: str | None

    @property
    def complete(self) -> bool:
        return self.problem is None and bool(self.token) and self.service is not None


def _resolve(value: object, env: dict[str, str]) -> str | None:
    if not isinstance(value, str) or value == "":
        return None
    if value.startswith("$"):
        resolved = env.get(value[1:])
        return resolved if resolved else None
    return value


def _is_missing(*values: object) -> bool:
    return any(value is None or value == "" for value in values)


def _incomplete(raw: dict[str, object]) -> Config:
    port = raw.get("port")
    return Config(
        port=port if isinstance(port, int) and not isinstance(port, bool) else DEFAULT_PORT,
        listen=LOOPBACK,
        token="",
        host_dir=Path(),
        service=None,
        problem="not_configured",
    )


def load_config(path: Path | None = None, env: dict[str, str] | None = None) -> Config:
    env = dict(os.environ if env is None else env)
    if path is None:
        path = Path(env.get(CONFIG_ENV, DEFAULT_CONFIG_PATH))

    if not path.exists():
        return Config(
            port=DEFAULT_PORT,
            listen=LOOPBACK,
            token="",
            host_dir=Path(),
            service=None,
            problem="not_configured",
        )

    mode = stat.S_IMODE(path.stat().st_mode)
    if mode != CONFIG_MODE:
        raise ConfigError("config file must be 0600")

    try:
        raw = json.loads(path.read_text())
    except (OSError, ValueError):
        return _incomplete({})
    if not isinstance(raw, dict):
        return _incomplete({})

    listen = raw.get("listen", LOOPBACK)
    if listen != LOOPBACK:
        raise ConfigError("listen address must be 127.0.0.1")

    port = raw.get("port", DEFAULT_PORT)
    if not isinstance(port, int) or isinstance(port, bool) or not 0 <= port <= 65535:
        return _incomplete(raw)

    token = _resolve(raw.get("token"), env)
    if token is not None and len(token) < MIN_TOKEN_LENGTH:
        raise ConfigError("token too short")

    host_dir = raw.get("host")
    service_raw = raw.get("service")
    if not isinstance(host_dir, str) or not host_dir or not isinstance(service_raw, dict):
        return _incomplete(raw)

    name = service_raw.get("name")
    code = service_raw.get("code")
    session = service_raw.get("session")
    gpu = service_raw.get("gpu")
    service_token = _resolve(service_raw.get("token"), env)
    auth_key = _resolve(service_raw.get("tailscaleAuthKey"), env)
    high_mem = service_raw.get("highMem", False)

    if not isinstance(name, str) or not isinstance(session, str) or not isinstance(gpu, str):
        return _incomplete(raw)
    if not isinstance(code, str) or not code or not isinstance(high_mem, bool):
        return _incomplete(raw)
    if _is_missing(name, session, gpu, token, service_token):
        return _incomplete(raw)

    return Config(
        port=port,
        listen=listen,
        token=token,
        host_dir=Path(host_dir),
        service=ServiceConfig(
            name=name,
            code=Path(code),
            session=session,
            gpu=gpu,
            high_mem=high_mem,
            token=service_token,
            tailscale_auth_key=auth_key,
        ),
        problem=None,
    )
