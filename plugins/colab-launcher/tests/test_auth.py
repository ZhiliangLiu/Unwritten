import os
import subprocess
import sys
from pathlib import Path

from launcher.app import create_app
from launcher.config import Config, load_config
from launcher.machine import Machine

LAUNCHER_TOKEN = "test-launcher-token-0123456789abcdef"
IMAGE_TOKEN = "test-image-token-0123456789abcdef"
LAUNCHER_DIR = Path(__file__).resolve().parents[1]


def run_launcher(path: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, "UNWRITTEN_LAUNCHER_CONFIG": str(path)}
    return subprocess.run(
        [sys.executable, "-m", "launcher"],
        cwd=LAUNCHER_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )


async def test_missing_and_wrong_token(launcher_client, auth_headers):
    missing = await launcher_client.get("/v1/info")
    assert missing.status == 401
    assert (await missing.json())["error"]["code"] == "unauthorized"

    wrong = await launcher_client.get("/v1/info", headers=auth_headers("wrong-token-0123456789abcdef0123456789"))
    assert wrong.status == 401
    assert (await wrong.json())["error"]["code"] == "unauthorized"

    allowed = await launcher_client.get("/v1/info", headers=auth_headers())
    assert allowed.status == 200

    for response in (missing, wrong, allowed):
        assert not any(name.lower().startswith("access-control-") for name in response.headers)
        assert not 300 <= response.status < 400


def test_config_file_must_be_0600(write_config):
    result = run_launcher(write_config(mode=0o644))
    assert result.returncode != 0
    assert "config file must be 0600" in result.stderr


def test_non_loopback_listen_refused(write_config):
    result = run_launcher(write_config(listen="0.0.0.0"))
    assert result.returncode != 0
    assert "listen address must be 127.0.0.1" in result.stderr


def test_short_token_refused_without_echoing_it(write_config):
    short = "short-token-0123456789"
    result = run_launcher(write_config(token=short))
    assert result.returncode != 0
    assert "token too short" in result.stderr
    assert short not in result.stderr


def test_config_resolves_environment_tokens(write_config):
    path = write_config(token="$LAUNCHER_TOKEN", service={"token": "$IMAGE_TOKEN"})
    config = load_config(path, {"LAUNCHER_TOKEN": LAUNCHER_TOKEN, "IMAGE_TOKEN": IMAGE_TOKEN})
    assert config.complete
    assert config.token == LAUNCHER_TOKEN
    assert config.service is not None
    assert config.service.token == IMAGE_TOKEN


def test_missing_environment_token_is_not_configured(write_config):
    path = write_config(token="$LAUNCHER_TOKEN")
    config = load_config(path, {})
    assert not config.complete
    assert config.problem == "not_configured"


def test_missing_config_file_does_not_stop_startup(tmp_path):
    config = load_config(tmp_path / "missing.json", {})
    assert not config.complete
    assert config.problem == "not_configured"


async def test_info_reports_not_configured(aiohttp_client, auth_headers):
    incomplete = Config(
        port=0,
        listen="127.0.0.1",
        token=LAUNCHER_TOKEN,
        host_dir=Path(),
        service=None,
        problem="not_configured",
    )
    client = await aiohttp_client(create_app(incomplete))
    response = await client.get("/v1/info", headers=auth_headers())
    body = await response.json()
    assert body["ready"] is False
    assert body["notReadyReason"] == "not_configured"


async def test_info_reports_not_signed_in(config, fake_colab, monkeypatch, aiohttp_client, auth_headers):
    monkeypatch.setenv("FAKE_COLAB_SIGNED_OUT", "1")
    client = await aiohttp_client(create_app(config))
    response = await client.get("/v1/info", headers=auth_headers())
    body = await response.json()
    assert body["ready"] is False
    assert body["notReadyReason"] == "not_signed_in"


async def test_info_reports_version_mismatch(config, fake_colab, monkeypatch, aiohttp_client, auth_headers):
    monkeypatch.setenv("FAKE_COLAB_VERSION", "0.0.1")
    client = await aiohttp_client(create_app(config))
    response = await client.get("/v1/info", headers=auth_headers())
    body = await response.json()
    assert body["ready"] is False
    assert body["notReadyReason"] == "not_configured"


async def test_info_ready_after_successful_checks(launcher_client, auth_headers):
    response = await launcher_client.get("/v1/info", headers=auth_headers())
    body = await response.json()
    assert body["ready"] is True
    assert body["notReadyReason"] is None


async def test_idempotent_start_replays_result(
    config, fake_colab, exec_script, aiohttp_client, auth_headers, wait_state
):
    exec_script(['unwritten-host {"phase": "serving"}'], hold=True)
    machine = Machine(config)
    client = await aiohttp_client(create_app(config, machine=machine))
    headers = auth_headers()
    body = {"idempotencyKey": "key-1", "idleMinutes": 30}

    first = await client.post("/v1/start", json=body, headers=headers)
    assert first.status == 202
    first_body = await first.json()
    await wait_state(machine, {"needs_action"})

    second = await client.post("/v1/start", json=body, headers=headers)
    assert second.status == 202
    assert await second.json() == first_body

    conflict = await client.post("/v1/start", json={"idempotencyKey": "key-1", "idleMinutes": 45}, headers=headers)
    assert conflict.status == 409
    assert (await conflict.json())["error"]["code"] == "idempotency_conflict"
    await machine.stop()


async def test_start_rejects_bad_idle_minutes(launcher_client, auth_headers):
    for idle_minutes in (4, 721):
        response = await launcher_client.post(
            "/v1/start",
            json={"idempotencyKey": f"key-{idle_minutes}", "idleMinutes": idle_minutes},
            headers=auth_headers(),
        )
        assert response.status == 400
        assert (await response.json())["error"]["code"] == "invalid_request"


async def test_continue_outside_needs_action_returns_invalid_state(launcher_client, auth_headers):
    response = await launcher_client.post(
        "/v1/continue",
        json={"idempotencyKey": "key-continue"},
        headers=auth_headers(),
    )
    assert response.status == 409
    assert (await response.json())["error"]["code"] == "invalid_state"


async def test_stop_returns_202_and_stops(launcher_client, auth_headers, wait_http_state):
    response = await launcher_client.post(
        "/v1/stop",
        json={"idempotencyKey": "key-stop"},
        headers=auth_headers(),
    )
    assert response.status == 202
    await wait_http_state(launcher_client, auth_headers(), {"stopped"})
