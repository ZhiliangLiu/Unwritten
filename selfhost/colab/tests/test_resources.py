from unwritten_colab.resources import (
    DISK_HEADROOM_GIB,
    Readings,
    ResourceError,
    check_resources,
    read_vram_gib,
)
from unwritten_colab.service import HostedService


def make_service(**overrides):
    values = {
        "name": "image",
        "hostname": "unwritten-image",
        "tag": "tag:unwritten-image",
        "token_secret": "IMAGE_TOKEN",
        "authkey_secret": "IMAGE_AUTHKEY",
        "min_vram_gib": 16.0,
        "min_ram_gib": 32.0,
        "port": 8188,
        "models_lock": None,
        "prepare": lambda paths: None,
        "start": lambda paths, token: [],
    }
    values.update(overrides)
    return HostedService(**values)


def test_each_shortage_is_reported_separately():
    shortages = check_resources(
        make_service(),
        100 * 2**30,
        Readings(vram_gib=8.0, ram_gib=16.0, disk_gib=100.0),
    )

    assert [item for item, _, _ in shortages] == ["vram", "ram", "disk"]
    assert shortages[0] == ("vram", 16.0, 8.0)
    assert shortages[1] == ("ram", 32.0, 16.0)
    assert shortages[2] == ("disk", 100 + DISK_HEADROOM_GIB, 100.0)


def test_min_ram_none_skips_ram_check():
    shortages = check_resources(
        make_service(min_ram_gib=None),
        0,
        Readings(vram_gib=64.0, ram_gib=1.0, disk_gib=1000.0),
    )

    assert shortages == []


def test_disk_need_is_models_plus_headroom():
    exactly_enough = check_resources(
        make_service(min_vram_gib=0.0, min_ram_gib=None),
        30 * 2**30,
        Readings(vram_gib=0.0, ram_gib=0.0, disk_gib=30 + DISK_HEADROOM_GIB),
    )
    one_gib_short = check_resources(
        make_service(min_vram_gib=0.0, min_ram_gib=None),
        30 * 2**30,
        Readings(vram_gib=0.0, ram_gib=0.0, disk_gib=30 + DISK_HEADROOM_GIB - 1),
    )

    assert exactly_enough == []
    assert one_gib_short == [("disk", 30 + DISK_HEADROOM_GIB, 30 + DISK_HEADROOM_GIB - 1)]


def test_reads_vram_from_nvidia_smi(fake_bin, monkeypatch):
    monkeypatch.setenv("FAKE_NVIDIA_SMI_MIB", "12288")

    assert read_vram_gib() == 12.0
    log = fake_bin.log_path.read_text()
    assert "--query-gpu=memory.total" in log
    assert "--format=csv,noheader,nounits" in log


def test_missing_nvidia_smi_raises(tmp_path, monkeypatch):
    monkeypatch.setenv("PATH", str(tmp_path))

    try:
        read_vram_gib()
    except ResourceError as error:
        assert str(error) == "nvidia-smi not found"
    else:
        raise AssertionError("expected ResourceError")
