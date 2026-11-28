import hashlib
import json
import shutil
from pathlib import Path

from unwritten_colab import Paths

import colab_service

PAYLOADS = {
    "mtp-q2_0.gguf": b"gguf",
    "rt/experts.bin": b"experts",
    "rt/dense.bin": b"dense",
    "rt/dense.txt": b"dense text",
    "rt/draft_vocab.bin": b"vocab",
}


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


ARTIFACT = {
    "name": "mtp-q2_0",
    "source": {"repo": "Qwen/Qwen3.8-Flash-Next", "commit": "test-commit"},
    "dest": "mtp",
    "files": [{"path": relative, "size": len(data), "sha256": digest(data)} for relative, data in PAYLOADS.items()],
}


def make_paths(tmp_path: Path) -> Paths:
    return Paths.for_service(
        "strata",
        tmp_path / "drive" / "unwritten",
        local_root=tmp_path / "local",
    )


def write_tree(root: Path) -> None:
    for relative, data in PAYLOADS.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def test_models_lock_mtp_artifact_matches_source_manifest():
    artifact = colab_service._artifact()
    manifest_path = Path(colab_service.__file__).parent / "mtp-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert artifact["name"] == "mtp-q2_0"
    assert len(manifest) == 31
    assert artifact["source"]["bytes"] == sum(item["bytes"] for item in manifest)
    assert hashlib.sha256(manifest_path.read_bytes()).hexdigest() == artifact["source"]["manifest_sha256"]
    mapping = {item["name"]: item["sha256"] for item in manifest}
    assert (
        hashlib.sha256(json.dumps(mapping, sort_keys=True).encode()).hexdigest()
        == artifact["source"]["tensor_map_sha256"]
    )
    paths = {entry["path"] for entry in artifact["files"]}
    assert paths == {"mtp-q2_0.gguf", "rt/experts.bin", "rt/dense.bin", "rt/dense.txt", "rt/draft_vocab.bin"}
    assert all(len(entry["sha256"]) == 64 for entry in artifact["files"])


def test_first_prepare_builds_then_caches_on_drive(tmp_path):
    paths = make_paths(tmp_path)
    calls = []

    def build(paths, artifact):
        calls.append(artifact["name"])
        write_tree(colab_service._local_root(paths))

    assert colab_service.sync_mtp(paths, ARTIFACT, build=build) is True
    assert calls == ["mtp-q2_0"]
    local = paths.local_root / "strata-data" / "mtp"
    cache = paths.drive_root / "strata" / "mtp"
    assert local == colab_service._local_root(paths)
    assert cache == colab_service._cache_root(paths)
    for relative, data in PAYLOADS.items():
        assert (local / relative).read_bytes() == data
        assert (cache / relative).read_bytes() == data
        assert (cache / f"{relative}.verified.json").is_file()


def test_cache_hit_restores_without_building(tmp_path):
    paths = make_paths(tmp_path)

    def build(paths, artifact):
        write_tree(colab_service._local_root(paths))

    assert colab_service.sync_mtp(paths, ARTIFACT, build=build) is True
    local = colab_service._local_root(paths)
    shutil.rmtree(local)
    calls = []

    def unexpected_build(paths, artifact):
        calls.append(artifact["name"])

    assert colab_service.sync_mtp(paths, ARTIFACT, build=unexpected_build) is True
    assert calls == []
    for relative, data in PAYLOADS.items():
        assert (local / relative).read_bytes() == data


def test_corrupted_cache_is_not_restored(tmp_path):
    paths = make_paths(tmp_path)

    def build(paths, artifact):
        write_tree(colab_service._local_root(paths))

    assert colab_service.sync_mtp(paths, ARTIFACT, build=build) is True
    cache = colab_service._cache_root(paths)
    local = colab_service._local_root(paths)
    shutil.rmtree(local)
    (cache / "rt/experts.bin").write_bytes(b"XXXXXXX")
    calls = []

    def rebuild(paths, artifact):
        calls.append(artifact["name"])
        write_tree(colab_service._local_root(paths))

    assert colab_service.sync_mtp(paths, ARTIFACT, build=rebuild) is True
    assert calls == ["mtp-q2_0"]
    assert (cache / "rt/experts.bin").read_bytes() == PAYLOADS["rt/experts.bin"]
    assert (local / "rt/experts.bin").read_bytes() == PAYLOADS["rt/experts.bin"]
