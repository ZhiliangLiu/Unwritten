import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from .state_file import STATE_PATH

LLM_GATEWAY_MAX_BODY_BYTES = 8 * 1024 * 1024
STRATA_HEALTH_INTERVAL_S = 60
STRATA_LOAD_TIMEOUT_S = 1800
MIN_TOKEN_LENGTH = 32


@dataclass(frozen=True)
class Config:
    token: str
    internal_key: str
    port: int = 8191
    strata_url: str = "http://127.0.0.1:8080"
    max_body_bytes: int = LLM_GATEWAY_MAX_BODY_BYTES
    health_interval_s: float = STRATA_HEALTH_INTERVAL_S
    load_timeout_s: float = STRATA_LOAD_TIMEOUT_S
    state_path: Path = STATE_PATH


def load(environ: Mapping[str, str] | None = None) -> Config:
    values = os.environ if environ is None else environ
    token = values.get("UNWRITTEN_LLM_TOKEN", "")
    if len(token) < MIN_TOKEN_LENGTH:
        raise SystemExit(f"UNWRITTEN_LLM_TOKEN must be at least {MIN_TOKEN_LENGTH} characters")
    internal_key = values.get("STRATA_INTERNAL_KEY", "")
    if not internal_key:
        raise SystemExit("STRATA_INTERNAL_KEY is required")
    try:
        port = int(values.get("UNWRITTEN_LLM_PORT", "8191"))
    except ValueError:
        raise SystemExit("UNWRITTEN_LLM_PORT must be an integer") from None
    strata_url = values.get("STRATA_URL", "http://127.0.0.1:8080").rstrip("/")
    if not strata_url:
        raise SystemExit("STRATA_URL must not be empty")
    return Config(token=token, internal_key=internal_key, port=port, strata_url=strata_url)
