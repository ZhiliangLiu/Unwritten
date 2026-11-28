from types import SimpleNamespace

import pytest
from unwritten_colab import Paths
from unwritten_colab.run import HostError

import colab_service


def test_start_raises_host_error_when_strata_launch_fails(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(colab_service.secrets, "token_urlsafe", lambda size: "internal-test-key")
    monkeypatch.setattr(colab_service.shutil, "which", lambda name: f"/usr/bin/{name}")

    def fake_run(*args, **kwargs):
        return SimpleNamespace(
            returncode=1,
            stdout="strata output internal-test-key\n",
            stderr="strata error\n",
        )

    monkeypatch.setattr(colab_service.subprocess, "run", fake_run)
    paths = Paths.for_service("strata", None, local_root=tmp_path)
    with pytest.raises(HostError) as error:
        colab_service.start(paths, "test-token-0123456789abcdef0123456789abcdef")
    assert str(error.value) == "strata launch failed"
    captured = capsys.readouterr()
    assert "strata output" in captured.err
    assert "strata error" in captured.err
    assert "<redacted>" in captured.err
    assert "internal-test-key" not in captured.err
