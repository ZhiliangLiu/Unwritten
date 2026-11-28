import shutil
from pathlib import Path

import pytest

from unwritten_colab.drive import DriveError, find_drive_root, is_mounted, unmount


class FakeDrive:
    def __init__(self, mount: Path, remove: bool) -> None:
        self.mount = mount
        self.remove = remove
        self.calls = 0

    def flush_and_unmount(self) -> None:
        self.calls += 1
        if self.remove:
            shutil.rmtree(self.mount)


@pytest.mark.parametrize("directory", ["MyDrive", "My Drive"])
def test_finds_drive_root(tmp_path, directory):
    mount = tmp_path / "drive"
    (mount / directory).mkdir(parents=True)

    assert find_drive_root(mount) == mount / directory / "unwritten"
    assert is_mounted(mount)


def test_unmount_requires_the_mount_to_disappear(tmp_path):
    mount = tmp_path / "drive"
    (mount / "MyDrive").mkdir(parents=True)
    drive = FakeDrive(mount, remove=True)

    unmount(drive, mount)

    assert drive.calls == 1
    assert not is_mounted(mount)


def test_unmount_fails_when_still_mounted(tmp_path):
    mount = tmp_path / "drive"
    (mount / "MyDrive").mkdir(parents=True)
    drive = FakeDrive(mount, remove=False)

    with pytest.raises(DriveError) as caught:
        unmount(drive, mount)

    assert str(caught.value) == "still mounted"
    assert is_mounted(mount)
