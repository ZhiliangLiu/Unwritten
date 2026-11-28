import importlib
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

TESTS_DIR = Path(__file__).parent
FAKE_BIN_DIR = TESTS_DIR / "fake_bin"

sys.path.insert(0, str(TESTS_DIR / "fake_colab"))

drive = importlib.import_module("google.colab.drive")
runtime = importlib.import_module("google.colab.runtime")
userdata = importlib.import_module("google.colab.userdata")


@pytest.fixture
def fake_colab(tmp_path):
    mount = tmp_path / "drive"
    mount.mkdir()
    drive.reset(mount)
    userdata.reset({})
    runtime.reset()
    return SimpleNamespace(drive=drive, userdata=userdata, runtime=runtime, mount=mount)


@pytest.fixture
def fake_bin(tmp_path, monkeypatch):
    log_path = tmp_path / "fake-bin.log"
    monkeypatch.setenv("FAKE_BIN_LOG", str(log_path))
    monkeypatch.setenv("PATH", f"{FAKE_BIN_DIR}{os.pathsep}{os.environ['PATH']}")
    return SimpleNamespace(log_path=log_path, directory=FAKE_BIN_DIR)
