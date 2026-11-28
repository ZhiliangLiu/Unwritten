import asyncio
import json
import secrets
import time
from pathlib import Path

from PIL import Image

from server.jobs import JobStore


class StubComfy:
    def __init__(self, output_dir: Path, state_path: Path) -> None:
        self.output_dir = output_dir
        self.state_path = state_path
        self.during: dict | None = None

    async def generate(self, graph, *, cancelled):
        if self.state_path.exists():
            self.during = json.loads(self.state_path.read_text())
        filename = "result.png"
        Image.new("RGB", (8, 8), (20, 30, 40)).save(self.output_dir / filename, "PNG")
        return [{"filename": filename, "subfolder": "", "type": "output"}]

    async def interrupt(self) -> None:
        return None


async def test_state_tracks_in_flight_and_activity(tmp_path, manifest, make_config):
    config = make_config("http://127.0.0.1:1")
    stub = StubComfy(config.output_dir, config.state_file)

    def clock() -> float:
        return 5000.0 + time.monotonic()

    jobs = JobStore(manifest, config, stub, clock=clock)
    jobs.set_ready(True, None)
    submitted = jobs.submit(
        {
            "idempotencyKey": secrets.token_hex(8),
            "prompt": "a quiet pier at dusk",
            "aspect": "3:2",
            "quality": "best",
        }
    )
    queued = json.loads(config.state_file.read_text())
    assert queued["inFlight"] == 1
    assert queued["lastActivityAt"] is None

    jobs.start_worker()
    for _ in range(500):
        if jobs.status(submitted["id"])["status"] == "done":
            break
        await asyncio.sleep(0.01)
    await jobs.stop_worker()

    assert stub.during is not None
    assert stub.during["inFlight"] == 1
    assert stub.during["lastActivityAt"] is not None
    finished = json.loads(config.state_file.read_text())
    assert finished["inFlight"] == 0
    assert finished["lastActivityAt"] is not None
