import logging
import shutil
from pathlib import Path
from typing import Any

from . import images
from .comfy import ComfyClient, OutOfMemory
from .config import Config
from .manifest import Manifest
from .workflow import fill

logger = logging.getLogger("server.selftest")

SELFTEST_PROMPT = "a plain ceramic cup on a wooden table, soft daylight"


def _output_path(config: Config, output: dict[str, Any]) -> Path:
    output_root = config.output_dir.resolve()
    candidate = (output_root / str(output.get("subfolder", "")) / str(output["filename"])).resolve()
    if not candidate.is_relative_to(output_root):
        raise ValueError("output outside the output directory")
    return candidate


async def run(manifest: Manifest, comfy: ComfyClient, config: Config) -> tuple[bool, str | None]:
    created: list[Path] = []
    try:
        saved: dict[str, Path] = {}
        for quality in ("best", "fast"):
            binding, template = manifest.template(f"t2i-{quality}")
            width, height = manifest.default_size(quality, manifest.default_aspect())
            graph, _ = fill(
                template,
                binding,
                {"prompt": SELFTEST_PROMPT, "seed": None, "width": width, "height": height},
                [],
            )
            outputs = await comfy.generate(graph, cancelled=lambda: False)
            path = _output_path(config, outputs[0])
            saved[quality] = path
            created.append(path)
        for quality in ("best", "fast"):
            reference = config.input_dir / f"unwritten-selftest-{quality}.png"
            config.input_dir.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(saved[quality], reference)
            created.append(reference)
            binding, template = manifest.template(f"edit-{quality}")
            width, height = manifest.default_size(quality, manifest.default_aspect())
            graph, _ = fill(
                template,
                binding,
                {"prompt": SELFTEST_PROMPT, "seed": None, "width": width, "height": height},
                [reference.name],
            )
            outputs = await comfy.generate(graph, cancelled=lambda: False)
            path = _output_path(config, outputs[0])
            created.append(path)
            images.encode_result(path)
        return True, None
    except OutOfMemory:
        return False, "out_of_memory"
    except Exception:
        logger.exception("selftest failed")
        return False, "workflow_error"
    finally:
        for path in created:
            path.unlink(missing_ok=True)
