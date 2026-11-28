import json
import stat
import tarfile

from launcher import packaging
from launcher.machine import Machine

SERVING_SCRIPT = ['unwritten-host {"phase": "serving"}']


def test_pack_excludes_tests_environments_and_notebooks(project_tree):
    host, code = project_tree
    archive = packaging.pack(host, code)
    with tarfile.open(archive) as tar:
        names = tar.getnames()

    assert "colab/unwritten_colab/__init__.py" in names
    assert "comfyui/code/colab_service.py" in names
    for name in names:
        parts = name.split("/")
        assert not {"tests", ".venv", "__pycache__", ".pytest_cache", ".ruff_cache"} & set(parts), name
        assert not name.endswith(".ipynb"), name


def test_launch_file_is_private_and_contains_expected_fields():
    path = packaging.write_launch_file("token-value", "auth-value", 30)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    assert json.loads(path.read_text()) == {
        "token": "token-value",
        "tailscaleAuthKey": "auth-value",
        "idleMinutes": 30,
    }


async def test_upload_removes_local_launch_file(config, fake_colab, exec_script, wait_state, monkeypatch):
    exec_script(SERVING_SCRIPT, hold=True)
    recorded = {}
    original = packaging.write_launch_file

    def wrapper(token, authkey, idle_minutes):
        path = original(token, authkey, idle_minutes)
        assert stat.S_IMODE(path.stat().st_mode) == 0o600
        recorded["path"] = path
        return path

    monkeypatch.setattr(packaging, "write_launch_file", wrapper)
    machine = Machine(config)
    machine.start(30)
    await wait_state(machine, {"needs_action"})
    assert not recorded["path"].exists()
    uploaded = fake_colab / "runtime" / "content" / "unwritten" / "launch.json"
    assert uploaded.exists()
    await machine.stop()
