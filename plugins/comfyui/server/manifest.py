import json
import subprocess
import tomllib
from pathlib import Path
from typing import Any

PROTOCOL = "unwritten-image/1"
MODEL = "Qwen-Image-2.1"
PYPROJECT = Path(__file__).resolve().parent.parent / "pyproject.toml"


class ManifestError(Exception):
    pass


def read_gpu_name() -> str | None:
    try:
        completed = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True,
            text=True,
            check=False,
        )
    except OSError:
        return None
    first_line = completed.stdout.splitlines()[0].strip() if completed.stdout else ""
    return first_line or None


def read_version(path: Path = PYPROJECT) -> str:
    with path.open("rb") as file:
        return str(tomllib.load(file)["project"]["version"])


class Manifest:
    def __init__(self, directory: Path, data: dict[str, Any], *, version: str, gpu_name: str | None) -> None:
        self.directory = directory
        self.templates: dict[str, dict[str, Any]] = data["templates"]
        self.default_sizes: dict[str, dict[str, list[int]]] = data["defaultSizes"]
        self.resolutions: dict[str, dict[str, dict[str, dict[str, int]]]] = data.get("resolutions", {})
        self.max_references = int(data["maxReferences"])
        self.max_reference_bytes = int(data["maxReferenceBytes"])
        self.max_prompt_length = int(data["maxPromptLength"])
        self.queue_max = int(data["queueMax"])
        self.version = version
        self.gpu_name = gpu_name
        self._templates: dict[str, dict[str, Any]] = {}

    @classmethod
    def load(cls, directory: Path, *, gpu_name: str | None = None) -> "Manifest":
        data = json.loads((directory / "manifest.json").read_text())
        effective_gpu = gpu_name if gpu_name is not None else read_gpu_name()
        return cls(directory, data, version=read_version(), gpu_name=effective_gpu)

    @property
    def aspects(self) -> list[str]:
        return list(self.default_sizes["best"].keys())

    @property
    def gpu_resolutions(self) -> dict[str, dict[str, dict[str, int]]]:
        if self.gpu_name is None:
            return {}
        return self.resolutions.get(self.gpu_name, {})

    @property
    def negative_prompt_effective(self) -> bool:
        return bool(self.templates) and all(template["negativePromptEffective"] for template in self.templates.values())

    def template(self, name: str) -> tuple[dict[str, Any], dict[str, Any]]:
        binding = self.templates[name]
        if name not in self._templates:
            self._templates[name] = json.loads((self.directory / binding["file"]).read_text())
        return binding, self._templates[name]

    def default_size(self, quality: str, aspect: str) -> tuple[int, int]:
        try:
            width, height = self.default_sizes[quality][aspect]
        except KeyError as error:
            raise ManifestError(f"no default size for {quality} {aspect}") from error
        return int(width), int(height)

    def default_aspect(self) -> str:
        return self.aspects[0]

    def size_allowed(self, aspect: str, width: int, height: int) -> bool:
        return any(
            size["width"] == width and size["height"] == height
            for size in self.gpu_resolutions.get(aspect, {}).values()
        )

    def info(self, ready: bool, reason: str | None, pending: int) -> dict[str, Any]:
        return {
            "protocol": PROTOCOL,
            "implementation": {"name": "ComfyUI", "version": self.version},
            "model": MODEL,
            "ready": ready,
            "notReadyReason": reason,
            "queue": {"pending": pending, "max": self.queue_max},
            "capabilities": {
                "maxReferences": self.max_references,
                "maxReferenceBytes": self.max_reference_bytes,
                "maxPromptLength": self.max_prompt_length,
                "seed": True,
                "negativePrompt": self.negative_prompt_effective,
                "qualities": ["fast", "best"],
                "aspects": self.aspects,
                "resolutions": self.gpu_resolutions,
            },
        }
