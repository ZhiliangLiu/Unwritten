import hashlib
import json
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread

import pytest

from unwritten_colab.models import ModelError, ensure_models, models_total_bytes


class FakeHuggingFace:
    def __init__(self) -> None:
        self.requests: list[str] = []
        self.files: dict[str, bytes] = {}
        self.server: ThreadingHTTPServer | None = None
        self.thread: Thread | None = None

    @property
    def url(self) -> str:
        assert self.server is not None
        return f"http://127.0.0.1:{self.server.server_port}"


@pytest.fixture
def fake_huggingface():
    fake = FakeHuggingFace()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            fake.requests.append(self.path)
            body = fake.files.get(self.path)
            if body is None:
                self.send_response(404)
                self.end_headers()
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

    fake.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    fake.thread = Thread(target=fake.server.serve_forever, daemon=True)
    fake.thread.start()
    yield fake
    assert fake.server is not None
    fake.server.shutdown()
    fake.server.server_close()
    assert fake.thread is not None
    fake.thread.join()


def make_entry(payload: bytes, *, sha256: str | None = None) -> dict:
    return {
        "repo": "acme/model",
        "commit": "abc123def456",
        "path": "weights.bin",
        "size": len(payload),
        "sha256": sha256 or hashlib.sha256(payload).hexdigest(),
        "dest": "model.bin",
    }


def make_opener(fake: FakeHuggingFace, requested: list[str]):
    browser = urllib.request.build_opener()

    def opener(url: str):
        requested.append(url)
        path = url.split("https://huggingface.co", 1)[1]
        return browser.open(fake.url + path)

    return opener


def test_downloads_missing_file_from_pinned_commit(tmp_path, fake_huggingface):
    payload = b"test-model-bytes" * 1000
    entry = make_entry(payload)
    route = f"/{entry['repo']}/resolve/{entry['commit']}/{entry['path']}"
    fake_huggingface.files[route] = payload
    requested: list[str] = []
    drive_models = tmp_path / "drive"
    local_models = tmp_path / "local"

    ensure_models({"files": [entry]}, drive_models, local_models, opener=make_opener(fake_huggingface, requested))

    assert (local_models / "model.bin").read_bytes() == payload
    assert (drive_models / "model.bin").read_bytes() == payload
    marker = json.loads((drive_models / "model.bin.verified.json").read_text())
    assert marker["size"] == len(payload)
    assert marker["mtime_ns"] == (drive_models / "model.bin").stat().st_mtime_ns
    assert fake_huggingface.requests == [route]
    assert requested == [f"https://huggingface.co{route}"]


def test_second_run_uses_marker_and_copies_from_drive(tmp_path, fake_huggingface):
    payload = b"test-model-bytes" * 1000
    entry = make_entry(payload)
    route = f"/{entry['repo']}/resolve/{entry['commit']}/{entry['path']}"
    fake_huggingface.files[route] = payload
    requested: list[str] = []
    drive_models = tmp_path / "drive"
    local_models = tmp_path / "local"
    lock = {"files": [entry]}
    opener = make_opener(fake_huggingface, requested)

    ensure_models(lock, drive_models, local_models, opener=opener)
    assert fake_huggingface.requests == [route]

    (local_models / "model.bin").unlink()
    fake_huggingface.requests.clear()
    requested.clear()

    ensure_models(lock, drive_models, local_models, opener=opener)

    assert fake_huggingface.requests == []
    assert requested == []
    assert (local_models / "model.bin").read_bytes() == payload


def test_wrong_sha256_fails_without_part_file(tmp_path, fake_huggingface):
    payload = b"test-model-bytes" * 1000
    entry = make_entry(payload, sha256=hashlib.sha256(b"another-payload").hexdigest())
    route = f"/{entry['repo']}/resolve/{entry['commit']}/{entry['path']}"
    fake_huggingface.files[route] = payload
    requested: list[str] = []
    local_models = tmp_path / "local"

    with pytest.raises(ModelError) as caught:
        ensure_models(
            {"files": [entry]},
            tmp_path / "drive",
            local_models,
            opener=make_opener(fake_huggingface, requested),
        )

    assert caught.value.dest == "model.bin"
    assert list(local_models.rglob("*.part")) == []


def test_marker_size_mismatch_revalidates_without_download(tmp_path, fake_huggingface):
    payload = b"test-model-bytes" * 1000
    entry = make_entry(payload)
    route = f"/{entry['repo']}/resolve/{entry['commit']}/{entry['path']}"
    fake_huggingface.files[route] = payload
    requested: list[str] = []
    drive_models = tmp_path / "drive"
    local_models = tmp_path / "local"
    lock = {"files": [entry]}
    opener = make_opener(fake_huggingface, requested)

    ensure_models(lock, drive_models, local_models, opener=opener)
    marker_path = drive_models / "model.bin.verified.json"
    marker = json.loads(marker_path.read_text())
    marker["size"] = 1
    marker_path.write_text(json.dumps(marker))
    fake_huggingface.requests.clear()
    requested.clear()

    ensure_models(lock, drive_models, local_models, opener=opener)

    assert fake_huggingface.requests == []
    assert requested == []
    assert json.loads(marker_path.read_text())["size"] == len(payload)


def test_corrupt_marker_is_treated_as_missing(tmp_path, fake_huggingface):
    payload = b"test-model-bytes" * 1000
    entry = make_entry(payload)
    route = f"/{entry['repo']}/resolve/{entry['commit']}/{entry['path']}"
    fake_huggingface.files[route] = payload
    requested: list[str] = []
    drive_models = tmp_path / "drive"
    local_models = tmp_path / "local"
    lock = {"files": [entry]}
    opener = make_opener(fake_huggingface, requested)

    ensure_models(lock, drive_models, local_models, opener=opener)
    (drive_models / "model.bin.verified.json").write_text("[]")
    fake_huggingface.requests.clear()
    requested.clear()

    ensure_models(lock, drive_models, local_models, opener=opener)

    assert fake_huggingface.requests == []
    assert requested == []
    assert json.loads((drive_models / "model.bin.verified.json").read_text())["size"] == len(payload)


def test_totals_lock_sizes():
    lock = {"files": [make_entry(b"a" * 10), make_entry(b"b" * 32)]}

    assert models_total_bytes(lock) == 42


def test_totals_include_artifact_source_and_files():
    lock = {
        "files": [make_entry(b"a" * 10)],
        "artifacts": [
            {
                "name": "derived",
                "source": {"repo": "acme/source", "commit": "abc123def456", "bytes": 20},
                "dest": "derived",
                "files": [
                    {"path": "one.bin", "size": 3, "sha256": "0" * 64},
                    {"path": "two.bin", "size": 4, "sha256": "1" * 64},
                ],
            }
        ],
    }

    assert models_total_bytes(lock) == 37
