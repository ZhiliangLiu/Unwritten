#!/usr/bin/env python3
import json
import os
import shutil
import sys
import time
from pathlib import Path


def state_dir() -> Path:
    value = os.environ.get("FAKE_COLAB_DIR")
    if not value:
        print("FAKE_COLAB_DIR is not set", file=sys.stderr)
        raise SystemExit(2)
    directory = Path(value)
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def record(state: Path, argv: list[str]) -> None:
    entry = {"argv": argv, "env": sorted(os.environ)}
    with (state / "calls.log").open("a") as handle:
        handle.write(json.dumps(entry) + "\n")


def sessions(state: Path) -> list[str]:
    directory = state / "sessions"
    if not directory.is_dir():
        return []
    return sorted(path.name for path in directory.iterdir() if path.is_dir())


def option(args: list[str], name: str) -> str | None:
    if name not in args:
        return None
    index = args.index(name)
    if index + 1 >= len(args):
        return None
    return args[index + 1]


def positional(args: list[str]) -> list[str]:
    result: list[str] = []
    index = 0
    while index < len(args):
        if args[index] in ("-s", "--session"):
            index += 2
            continue
        result.append(args[index])
        index += 1
    return result


def session_name(args: list[str]) -> str | None:
    return option(args, "-s") or option(args, "--session")


def version() -> int:
    print(f"google-colab-cli {os.environ.get('FAKE_COLAB_VERSION', '0.8.0')}")
    return 0


def list_sessions(state: Path) -> int:
    if os.environ.get("FAKE_COLAB_SIGNED_OUT") == "1":
        print("401 Unauthorized", file=sys.stderr)
        return 1
    names = sessions(state)
    if not names:
        print("No active sessions")
        return 0
    for name in names:
        print(f"[{name}] A100 40GB | High-RAM: no")
    return 0


def new_session(state: Path, args: list[str]) -> int:
    outcome = os.environ.get("FAKE_COLAB_NEW", "ok")
    if outcome == "400":
        print("400 Bad Request: no quota or accelerator", file=sys.stderr)
        return 1
    if outcome == "401":
        print("401 Unauthorized", file=sys.stderr)
        return 1
    name = session_name(args) or "default"
    (state / "sessions" / name).mkdir(parents=True, exist_ok=True)
    print(f"created session {name}")
    return 0


def upload(state: Path, args: list[str]) -> int:
    name = session_name(args)
    if name is None or not (state / "sessions" / name).is_dir():
        print("no such session", file=sys.stderr)
        return 1
    files = positional(args)
    if len(files) != 2:
        print("upload needs local and remote paths", file=sys.stderr)
        return 2
    local, remote = Path(files[0]), files[1]
    target = state / "runtime" / remote.lstrip("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(local, target)
    return 0


def drivemount(state: Path, args: list[str]) -> int:
    if os.environ.get("FAKE_COLAB_CONSENT", "1") == "0":
        return 0
    url = os.environ.get("FAKE_COLAB_CONSENT_URL", "https://accounts.google.com/o/oauth2/x")
    print("Please visit:")
    print()
    print(url, flush=True)
    line = sys.stdin.readline()
    (state / "drivemount.stdin").write_text(line)
    return 0


def run_exec(state: Path, args: list[str]) -> int:
    name = session_name(args)
    if name is None or not (state / "sessions" / name).is_dir():
        print("no such session", file=sys.stderr)
        return 1
    script = os.environ.get("FAKE_COLAB_EXEC_SCRIPT")
    delay = float(os.environ.get("FAKE_COLAB_EXEC_DELAY", "0.02"))
    if script:
        for line in Path(script).read_text().splitlines():
            print(line, flush=True)
            time.sleep(delay)
    if os.environ.get("FAKE_COLAB_EXEC_HOLD") == "1":
        while True:
            time.sleep(1)
    return 0


def stop_session(state: Path, args: list[str]) -> int:
    name = session_name(args)
    path = state / "sessions" / name if name is not None else None
    if path is None or not path.is_dir():
        print("no such session", file=sys.stderr)
        return 1
    shutil.rmtree(path)
    return 0


def main(argv: list[str]) -> int:
    state = state_dir()
    record(state, argv)
    if len(argv) < 2:
        print("missing command", file=sys.stderr)
        return 2
    command = argv[1]
    args = argv[2:]
    if command == "version":
        return version()
    if command == "sessions":
        return list_sessions(state)
    if command == "new":
        return new_session(state, args)
    if command == "upload":
        return upload(state, args)
    if command == "drivemount":
        return drivemount(state, args)
    if command == "exec":
        return run_exec(state, args)
    if command == "stop":
        return stop_session(state, args)
    print(f"unknown command {command}", file=sys.stderr)
    return 2


raise SystemExit(main(sys.argv))
