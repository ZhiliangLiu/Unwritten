import asyncio
import base64
import binascii
import hashlib
import json
import logging
import secrets
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image

from . import images
from .comfy import ComfyClient, ComfyError, InternalError, Interrupted, OutOfMemory, WorkflowError
from .config import RESULT_RETENTION_S, Config
from .manifest import Manifest, ManifestError
from .state_file import write
from .workflow import fill

logger = logging.getLogger("server.jobs")

REFERENCE_MIMES = {"image/png", "image/jpeg", "image/webp"}
TERMINAL_STATUSES = {"done", "failed", "cancelled"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        self.status = status
        self.code = code
        self.message = message
        super().__init__(message)


@dataclass
class Job:
    id: str
    sequence: int
    idempotency_key: str
    prompt: str
    references: list[Image.Image]
    aspect: str
    quality: str
    seed: int | None
    size: tuple[int, int] | None
    status: str = "queued"
    width: int | None = None
    height: int | None = None
    error: dict[str, str] | None = None
    image: bytes | None = None
    finished_at: float | None = None
    cancel_requested: bool = False


def _invalid(message: str) -> ApiError:
    return ApiError(400, "invalid_request", message)


def _canonical_hash(body: dict[str, Any]) -> str:
    canonical = json.dumps(body, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def _positive_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def _decoded_references(body: dict[str, Any], manifest: Manifest) -> list[bytes]:
    raw = body.get("references", [])
    if not isinstance(raw, list):
        raise _invalid("references must be a list")
    if len(raw) > manifest.max_references:
        raise ApiError(400, "too_many_references", "too many references")
    decoded: list[bytes] = []
    for reference in raw:
        if not isinstance(reference, dict):
            raise _invalid("each reference must be an object")
        mime = reference.get("mime")
        data = reference.get("data")
        if not isinstance(mime, str) or mime not in REFERENCE_MIMES or not isinstance(data, str):
            raise _invalid("each reference needs a mime and base64 data")
        try:
            payload = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError) as error:
            raise _invalid("reference data is not valid base64") from error
        if len(payload) > manifest.max_reference_bytes:
            raise ApiError(413, "reference_too_large", "reference too large")
        decoded.append(payload)
    return decoded


def _loaded_references(decoded: list[bytes]) -> list[Image.Image]:
    loaded: list[Image.Image] = []
    for payload in decoded:
        try:
            loaded.append(images.load_reference(payload))
        except images.InvalidImage as error:
            raise _invalid("reference is not a valid image") from error
    return loaded


@dataclass
class JobValues:
    idempotency_key: str
    request_hash: str
    prompt: str
    references: list[Image.Image]
    aspect: str
    quality: str
    seed: int | None
    size: tuple[int, int] | None


def _validated_values(body: dict[str, Any], manifest: Manifest) -> JobValues:
    idempotency_key = body.get("idempotencyKey")
    prompt = body.get("prompt")
    aspect = body.get("aspect")
    quality = body.get("quality")
    seed = body.get("seed")
    if not isinstance(idempotency_key, str) or not idempotency_key:
        raise _invalid("idempotencyKey must be a non-empty string")
    if not isinstance(prompt, str):
        raise _invalid("prompt must be a string")
    if len(prompt) > manifest.max_prompt_length:
        raise _invalid("prompt is too long")
    decoded_references = _decoded_references(body, manifest)
    if not isinstance(aspect, str) or aspect not in manifest.aspects:
        raise ApiError(400, "unsupported_aspect", "unsupported aspect")
    if not isinstance(quality, str) or quality not in ("fast", "best"):
        raise ApiError(400, "unsupported_quality", "unsupported quality")
    size_raw = body.get("size")
    size: tuple[int, int] | None = None
    if size_raw is not None:
        if (
            not isinstance(size_raw, dict)
            or not _positive_int(size_raw.get("width"))
            or not _positive_int(size_raw.get("height"))
        ):
            raise _invalid("size needs positive integer width and height")
        width = int(size_raw["width"])
        height = int(size_raw["height"])
        if not manifest.size_allowed(aspect, width, height):
            raise ApiError(400, "unsupported_size", "unsupported size")
        size = (width, height)
    if seed is not None and (not isinstance(seed, int) or isinstance(seed, bool)):
        raise _invalid("seed must be an integer")
    return JobValues(
        idempotency_key=idempotency_key,
        request_hash=_canonical_hash(body),
        prompt=prompt,
        references=_loaded_references(decoded_references),
        aspect=aspect,
        quality=quality,
        seed=seed,
        size=size,
    )


class JobStore:
    def __init__(
        self,
        manifest: Manifest,
        config: Config,
        comfy: ComfyClient,
        *,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.manifest = manifest
        self.config = config
        self.comfy = comfy
        self.clock = clock
        self.jobs: dict[str, Job] = {}
        self.idempotency: dict[str, tuple[str, str]] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.ready = False
        self.reason: str | None = "starting"
        self.last_activity_at: float | None = None
        self._sequence = 0
        self._worker: asyncio.Task[None] | None = None

    def _queued(self) -> list[Job]:
        return sorted(
            (job for job in self.jobs.values() if job.status == "queued"),
            key=lambda job: job.sequence,
        )

    def pending_count(self) -> int:
        return len(self._queued())

    def _in_flight(self) -> int:
        return sum(1 for job in self.jobs.values() if job.status in ("queued", "running"))

    def write_state(self) -> None:
        try:
            write(
                self.config.state_file,
                ready=self.ready,
                reason=self.reason,
                in_flight=self._in_flight(),
                last_activity_at=self.last_activity_at,
            )
        except OSError:
            logger.warning("state file is not writable")

    def set_ready(self, ready: bool, reason: str | None) -> None:
        self.ready = ready
        self.reason = None if ready else reason
        self.write_state()

    def purge_expired(self) -> None:
        now = self.clock()
        for job in list(self.jobs.values()):
            if job.status not in TERMINAL_STATUSES or job.finished_at is None:
                continue
            if now - job.finished_at < RESULT_RETENTION_S:
                continue
            self.jobs.pop(job.id, None)
            if self.idempotency.get(job.idempotency_key, (None, None))[1] == job.id:
                self.idempotency.pop(job.idempotency_key, None)

    def submit(self, body: dict[str, Any]) -> dict[str, Any]:
        if not self.ready:
            raise ApiError(503, "not_ready", "service is not ready")
        self.purge_expired()
        key = body.get("idempotencyKey")
        if isinstance(key, str) and key:
            request_hash = _canonical_hash(body)
            existing = self.idempotency.get(key)
            if existing is not None:
                if existing[0] != request_hash:
                    raise ApiError(409, "idempotency_conflict", "idempotency key was used for another request")
                job = self.jobs.get(existing[1])
                if job is not None:
                    return {"id": job.id, "status": job.status}
        values = _validated_values(body, self.manifest)
        if len(self._queued()) >= self.manifest.queue_max:
            raise ApiError(429, "busy", "queue is full")

        self._sequence += 1
        job = Job(
            id=secrets.token_hex(16),
            sequence=self._sequence,
            idempotency_key=values.idempotency_key,
            prompt=values.prompt,
            references=values.references,
            aspect=values.aspect,
            quality=values.quality,
            seed=values.seed,
            size=values.size,
        )
        self.jobs[job.id] = job
        self.idempotency[job.idempotency_key] = (values.request_hash, job.id)
        self.queue.put_nowait(job.id)
        self.write_state()
        return {"id": job.id, "status": job.status}

    def status(self, job_id: str) -> dict[str, Any]:
        self.purge_expired()
        job = self.jobs.get(job_id)
        if job is None:
            raise ApiError(404, "not_found", "job not found")
        payload: dict[str, Any] = {
            "id": job.id,
            "status": job.status,
            "seed": job.seed,
            "width": job.width,
            "height": job.height,
            "error": job.error,
        }
        if job.status == "queued":
            queued = self._queued()
            payload["position"] = next(
                (index + 1 for index, candidate in enumerate(queued) if candidate.id == job.id),
                None,
            )
        return payload

    def image(self, job_id: str) -> bytes:
        self.purge_expired()
        job = self.jobs.get(job_id)
        if job is None or job.status != "done" or job.image is None:
            raise ApiError(404, "not_found", "image not found")
        return job.image

    async def cancel(self, job_id: str) -> None:
        self.purge_expired()
        job = self.jobs.get(job_id)
        if job is None:
            raise ApiError(404, "not_found", "job not found")
        if job.status == "queued":
            job.status = "cancelled"
            job.finished_at = self.clock()
            job.references = []
        elif job.status == "running":
            job.cancel_requested = True
            try:
                await self.comfy.interrupt()
            except ComfyError:
                logger.info("job %s interrupt failed", job.id)
        elif job.status == "done":
            job.image = None
        self.write_state()

    def _output_path(self, output: dict[str, Any]) -> Path:
        output_root = self.config.output_dir.resolve()
        candidate = (output_root / str(output.get("subfolder", "")) / str(output["filename"])).resolve()
        if not candidate.is_relative_to(output_root):
            raise WorkflowError("comfyui returned a path outside the output directory")
        return candidate

    def _cleanup(self, job: Job, outputs: list[Path]) -> None:
        for index in range(1, 11):
            (self.config.input_dir / f"unwritten-{job.id}-{index}.png").unlink(missing_ok=True)
        for path in outputs:
            path.unlink(missing_ok=True)

    async def _run_job(self, job: Job) -> None:
        job.status = "running"
        self.last_activity_at = self.clock()
        self.write_state()
        started = time.monotonic()
        outputs: list[Path] = []
        try:
            template_name = ("edit-" if job.references else "t2i-") + job.quality
            binding, template = self.manifest.template(template_name)
            width, height = job.size if job.size is not None else self.manifest.default_size(job.quality, job.aspect)
            job.width, job.height = width, height
            reference_names: list[str] = []
            self.config.input_dir.mkdir(parents=True, exist_ok=True)
            for index, reference in enumerate(job.references, start=1):
                name = f"unwritten-{job.id}-{index}.png"
                path = self.config.input_dir / name
                reference.save(path, "PNG")
                reference_names.append(name)
            graph, seed = fill(
                template,
                binding,
                {"prompt": job.prompt, "seed": job.seed, "width": width, "height": height},
                reference_names,
            )
            job.seed = seed
            files = await self.comfy.generate(graph, cancelled=lambda: job.cancel_requested)
            outputs = [self._output_path(output) for output in files]
            job.image = images.encode_result(outputs[0])
            job.status = "done"
        except Interrupted:
            job.status = "cancelled"
        except OutOfMemory:
            job.status = "failed"
            job.error = {"code": "out_of_memory", "message": "out of memory"}
        except WorkflowError:
            job.status = "failed"
            job.error = {"code": "workflow_error", "message": "workflow error"}
        except (InternalError, ManifestError, OSError):
            job.status = "failed"
            job.error = {"code": "internal", "message": "internal error"}
        except Exception:
            logger.exception("job %s failed unexpectedly", job.id)
            job.status = "failed"
            job.error = {"code": "internal", "message": "internal error"}
        finally:
            if job.cancel_requested and job.status != "done":
                job.status = "cancelled"
            job.finished_at = self.clock()
            job.references = []
            job.prompt = ""
            self._cleanup(job, outputs)
            self.last_activity_at = self.clock()
            self.write_state()
            logger.info(
                "job %s %s %.2fs",
                job.id,
                job.status,
                time.monotonic() - started,
            )

    async def run_forever(self) -> None:
        while True:
            job_id = await self.queue.get()
            try:
                job = self.jobs.get(job_id)
                if job is None or job.status != "queued":
                    continue
                await self._run_job(job)
            finally:
                self.queue.task_done()

    def start_worker(self) -> None:
        self._worker = asyncio.create_task(self.run_forever())

    async def stop_worker(self) -> None:
        if self._worker is None:
            return
        self._worker.cancel()
        try:
            await self._worker
        except asyncio.CancelledError:
            pass
        self._worker = None
