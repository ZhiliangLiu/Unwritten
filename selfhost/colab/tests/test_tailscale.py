from pathlib import Path

import pytest

from unwritten_colab import tailscale
from unwritten_colab.tailscale import SOCKET_PATH, TailscaleError


@pytest.fixture(autouse=True)
def clean_socket():
    SOCKET_PATH.unlink(missing_ok=True)
    yield
    SOCKET_PATH.unlink(missing_ok=True)


def test_up_without_identity_uses_auth_key_file(fake_bin):
    key = "tskey-auth-SECRET-0123456789abcdef"

    tailscale.up("unwritten-image", "tag:unwritten-image", key)

    log = fake_bin.log_path.read_text()
    assert "--hostname=unwritten-image" in log
    assert "--advertise-tags=tag:unwritten-image" in log
    assert "--auth-key=file:" in log
    assert key not in log
    assert f"authkey-file-length={len(key)}" in log
    assert "authkey-file-mode=600" in log
    authkey_file = None
    for line in log.splitlines():
        if line.startswith("--auth-key=file:"):
            authkey_file = Path(line.split("file:", 1)[1])
    assert authkey_file is not None
    assert not authkey_file.exists()


def test_up_with_identity_has_no_auth_key(fake_bin):
    tailscale.up("unwritten-image", "tag:unwritten-image", None)

    log = fake_bin.log_path.read_text()
    assert "--hostname=unwritten-image" in log
    assert "--auth-key" not in log


def test_start_tailscaled_creates_socket(fake_bin, tmp_path):
    statedir = tmp_path / "tailscale"

    process = tailscale.start_tailscaled(statedir)
    try:
        assert SOCKET_PATH.exists()
        log = fake_bin.log_path.read_text()
        assert "--tun=userspace-networking" in log
        assert f"--statedir={statedir}" in log
        assert f"--socket={SOCKET_PATH}" in log
    finally:
        process.terminate()
        process.wait(timeout=5)

    assert not SOCKET_PATH.exists()


def test_dns_name_uses_self_dns_name(fake_bin, monkeypatch):
    monkeypatch.setenv("FAKE_TAILSCALE_DNS_NAME", "unwritten-image.example.ts.net.")

    assert tailscale.dns_name() == "https://unwritten-image.example.ts.net"


def test_failure_raises_without_the_command_line(fake_bin, monkeypatch):
    monkeypatch.setenv("FAKE_TAILSCALE_FAIL", "1")

    with pytest.raises(TailscaleError) as caught:
        tailscale.up("unwritten-image", "tag:unwritten-image", None)

    assert str(caught.value) == "up"
