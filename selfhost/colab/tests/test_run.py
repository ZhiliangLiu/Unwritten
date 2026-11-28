import json
from pathlib import Path

import pytest

from unwritten_colab import state
from unwritten_colab.paths import Paths
from unwritten_colab.run import HostError, RunDeps, run
from unwritten_colab.service import HostedService

TOKEN = "test-token-0123456789abcdef0123456789abcdef"
AUTHKEY = "tskey-auth-test-0123456789abcdef"


class FakeProcess:
    def __init__(self, args=None):
        self.args = args or ["worker"]


class Recorder:
    def __init__(self):
        self.actions: list[tuple[str, dict]] = []

    def add(self, name, **data):
        self.actions.append((name, data))

    def names(self):
        return [name for name, _ in self.actions]

    def index(self, name):
        return self.names().index(name)


def make_service(recorder, *, prepare=None, start=None):
    def default_prepare(paths):
        recorder.add("prepare")

    def default_start(paths, token):
        recorder.add("start")
        return [FakeProcess(args=["python", "service.py"])]

    return HostedService(
        name="image",
        hostname="unwritten-image",
        tag="tag:unwritten-image",
        token_secret="IMAGE_TOKEN",
        authkey_secret="IMAGE_AUTHKEY",
        min_vram_gib=16.0,
        min_ram_gib=32.0,
        port=8188,
        models_lock=None,
        prepare=prepare or default_prepare,
        start=start or default_start,
    )


def make_paths_factory(tmp_path):
    local_root = tmp_path / "local"
    state_file = tmp_path / "state.json"

    def paths_for_service(name, drive_root):
        return Paths.for_service(name, drive_root, local_root=local_root, state_file=state_file)

    return paths_for_service, local_root, state_file


def has_identity(tailscale_dir):
    state_path = Path(tailscale_dir) / "tailscaled.state"
    return state_path.is_file() and state_path.stat().st_size > 0


def make_deps(
    recorder,
    *,
    drive_root,
    paths_for_service,
    userdata,
    runtime,
    readings=(64.0, 64.0, 1000.0),
    identity=has_identity,
):
    def copy_tree(src, dst):
        recorder.add("copy_tree", src=src, dst=dst)
        Path(dst).mkdir(parents=True, exist_ok=True)

    def unwatch(**kwargs):
        recorder.add("watch", **kwargs)
        return "idle"

    return RunDeps(
        drive=object(),
        userdata=userdata,
        runtime=runtime,
        paths_for_service=paths_for_service,
        find_drive_root=lambda: drive_root,
        copy_tree=copy_tree,
        unmount=lambda drive: recorder.add("unmount"),
        read_vram_gib=lambda: readings[0],
        read_ram_gib=lambda: readings[1],
        free_disk_gib=lambda path: readings[2],
        load_lock=lambda path: {"files": []},
        models_total_bytes=lambda lock: 0,
        ensure_models=lambda lock, drive_models, local_models: recorder.add("ensure_models"),
        install=lambda: recorder.add("install"),
        start_tailscaled=lambda statedir: FakeProcess(args=["tailscaled"]),
        has_identity=identity,
        up=lambda hostname, tag, authkey: recorder.add("up", hostname=hostname, tag=tag, authkey=authkey),
        serve=lambda port: recorder.add("serve", port=port),
        dns_name=lambda: "https://unwritten-image.example.ts.net",
        read_state=lambda path: state.ServiceState(
            ready=True, not_ready_reason=None, in_flight=0, last_activity_at=None
        ),
        watch=unwatch,
        sleep=lambda seconds: None,
        clock=lambda: 0.0,
    )


def status_lines(output):
    return [
        json.loads(line.removeprefix("unwritten-host "))
        for line in output.splitlines()
        if line.startswith("unwritten-host ")
    ]


def test_launcher_runs_steps_in_order_and_unmounts_before_start(tmp_path, fake_colab, capsys):
    recorder = Recorder()
    paths_for_service, local_root, state_file = make_paths_factory(tmp_path)
    drive_root = tmp_path / "drive" / "unwritten"
    (drive_root / "image" / "tailscale").mkdir(parents=True)
    local_root.mkdir()
    launch_path = local_root / "launch.json"
    launch_path.write_text(json.dumps({"token": TOKEN, "tailscaleAuthKey": AUTHKEY, "idleMinutes": 7}))
    service = make_service(recorder)
    deps = make_deps(
        recorder,
        drive_root=drive_root,
        paths_for_service=paths_for_service,
        userdata=fake_colab.userdata,
        runtime=fake_colab.runtime,
    )

    run(service, mode="launcher", idle_minutes=30, deps=deps)

    output = capsys.readouterr().out
    assert [line["phase"] for line in status_lines(output)] == [
        "copying",
        "preparing",
        "models",
        "tailscale",
        "starting",
        "serving",
    ]
    assert recorder.index("unmount") < recorder.index("start")
    state_copy = next(
        index
        for index, (name, data) in enumerate(recorder.actions)
        if name == "copy_tree" and data["dst"] == drive_root / "image" / "tailscale"
    )
    assert state_copy < recorder.index("unmount")
    watch_call = next(data for name, data in recorder.actions if name == "watch")
    assert watch_call["idle_minutes"] == 7
    assert watch_call["state_path"] == state_file
    assert [name for name, _ in watch_call["processes"]] == ["tailscaled", "service.py"]
    assert TOKEN not in output
    assert AUTHKEY not in output
    assert not launch_path.exists()


def test_notebook_reads_auth_key_only_without_identity(tmp_path, fake_colab, capsys):
    recorder = Recorder()
    paths_for_service, local_root, _ = make_paths_factory(tmp_path)
    drive_root = tmp_path / "drive" / "unwritten"
    drive_root.mkdir(parents=True)
    fake_colab.userdata.reset({"IMAGE_TOKEN": TOKEN, "IMAGE_AUTHKEY": AUTHKEY})
    service = make_service(recorder)
    deps = make_deps(
        recorder,
        drive_root=drive_root,
        paths_for_service=paths_for_service,
        userdata=fake_colab.userdata,
        runtime=fake_colab.runtime,
    )

    run(service, mode="notebook", idle_minutes=30, deps=deps)

    assert fake_colab.userdata.requested() == ["IMAGE_TOKEN", "IMAGE_AUTHKEY"]
    assert not any(line.startswith("unwritten-host ") for line in capsys.readouterr().out.splitlines())

    tailscale_dir = local_root / "image" / "tailscale"
    tailscale_dir.mkdir(parents=True, exist_ok=True)
    (tailscale_dir / "tailscaled.state").write_text("node-state")
    fake_colab.userdata.reset({"IMAGE_TOKEN": TOKEN, "IMAGE_AUTHKEY": AUTHKEY})
    recorder.actions.clear()

    run(service, mode="notebook", idle_minutes=30, deps=deps)

    assert fake_colab.userdata.requested() == ["IMAGE_TOKEN"]
    output = capsys.readouterr().out
    assert TOKEN not in output
    assert AUTHKEY not in output


def test_insufficient_resources_stops_before_models(tmp_path, fake_colab, capsys):
    recorder = Recorder()
    paths_for_service, local_root, _ = make_paths_factory(tmp_path)
    drive_root = tmp_path / "drive" / "unwritten"
    (drive_root / "image" / "tailscale").mkdir(parents=True)
    local_root.mkdir()
    (local_root / "launch.json").write_text(json.dumps({"token": TOKEN, "idleMinutes": 10}))
    service = make_service(recorder)
    deps = make_deps(
        recorder,
        drive_root=drive_root,
        paths_for_service=paths_for_service,
        userdata=fake_colab.userdata,
        runtime=fake_colab.runtime,
        readings=(1.0, 64.0, 1000.0),
    )

    with pytest.raises(HostError):
        run(service, mode="launcher", idle_minutes=10, deps=deps)

    assert "prepare" not in recorder.names()
    assert "ensure_models" not in recorder.names()
    output = capsys.readouterr().out
    assert [line["phase"] for line in status_lines(output)] == ["copying", "exiting"]
    assert status_lines(output)[1] == {"phase": "exiting", "reason": "error", "step": "resources"}
    assert "insufficient vram" in output
    assert TOKEN not in output


def test_missing_drive_stops_before_copying_code(tmp_path, fake_colab, capsys):
    recorder = Recorder()
    paths_for_service, _, _ = make_paths_factory(tmp_path)
    service = make_service(recorder)
    deps = make_deps(
        recorder,
        drive_root=None,
        paths_for_service=paths_for_service,
        userdata=fake_colab.userdata,
        runtime=fake_colab.runtime,
    )

    with pytest.raises(HostError) as caught:
        run(service, mode="launcher", idle_minutes=10, deps=deps)

    assert str(caught.value) == "drive not mounted"
    assert "copy_tree" not in recorder.names()
    output = capsys.readouterr().out
    assert status_lines(output)[-1] == {"phase": "exiting", "reason": "error", "step": "copying"}
