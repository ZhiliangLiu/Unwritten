from pathlib import Path
from typing import Any

from aiohttp import web
from PIL import Image, PngImagePlugin

ALLOWED_INPUTS: dict[str, set[str]] = {
    "EmptyLatentImage": {"width", "height", "batch_size"},
    "KSampler": {
        "seed",
        "steps",
        "cfg",
        "sampler_name",
        "scheduler",
        "denoise",
        "model",
        "positive",
        "negative",
        "latent_image",
    },
    "UNETLoader": {"unet_name", "weight_dtype"},
    "CLIPLoader": {"clip_name", "type"},
    "VAELoader": {"vae_name"},
    "VAEDecode": {"samples", "vae"},
    "SaveImage": {"filename_prefix", "images"},
    "LoadImage": {"image"},
    "LoraLoaderModelOnly": {"model", "lora_name", "strength_model"},
}
CLIP_TEXT_INPUTS = {"text", "clip"} | {f"image_{index}" for index in range(1, 11)}
ALLOWED_INPUTS["CLIPTextEncode"] = CLIP_TEXT_INPUTS
POLLS_BEFORE_OUTPUT = 2


class FakeComfy:
    def __init__(self, output_dir: Path) -> None:
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.received: list[dict[str, Any]] = []
        self.interrupts = 0
        self.prompt_error = False
        self.execution_error: str | None = None
        self.output_files: list[Path] = []
        self._graphs: dict[str, dict[str, Any]] = {}
        self._counter = 0
        self._polls: dict[str, int] = {}

    def app(self) -> web.Application:
        app = web.Application()
        app.router.add_post("/prompt", self._prompt)
        app.router.add_get("/history/{prompt_id}", self._history)
        app.router.add_post("/interrupt", self._interrupt)
        app.router.add_get("/system_stats", self._system_stats)
        return app

    def _invalid_input(self, graph: dict[str, Any]) -> str | None:
        for node_id, node in graph.items():
            if not isinstance(node, dict):
                return f"node {node_id} is not an object"
            class_type = node.get("class_type")
            inputs = node.get("inputs")
            if not isinstance(inputs, dict):
                return f"node {node_id} has no inputs"
            allowed = ALLOWED_INPUTS.get(class_type)
            if allowed is None:
                continue
            unknown = set(inputs) - allowed
            if unknown:
                return f"node {node_id} has unknown input {sorted(unknown)[0]}"
        return None

    async def _prompt(self, request: web.Request) -> web.Response:
        payload = await request.json()
        self.received.append(payload)
        graph = payload.get("prompt") if isinstance(payload, dict) else None
        problem = self._invalid_input(graph) if isinstance(graph, dict) else "prompt is missing"
        if self.prompt_error or problem is not None:
            return web.json_response(
                {
                    "error": {
                        "type": "prompt_outputs_failed_validation",
                        "message": problem or "prompt outputs failed validation",
                        "details": "",
                        "extra_info": {},
                    },
                    "node_errors": {},
                },
                status=400,
            )
        self._counter += 1
        prompt_id = f"fake-{self._counter}"
        self._graphs[prompt_id] = graph
        return web.json_response({"prompt_id": prompt_id})

    def _latent_size(self, graph: dict[str, Any]) -> tuple[int, int]:
        for node in graph.values():
            if isinstance(node, dict) and node.get("class_type") == "EmptyLatentImage":
                inputs = node.get("inputs", {})
                width = int(inputs.get("width", 64))
                height = int(inputs.get("height", 48))
                return width, height
        return 64, 48

    async def _history(self, request: web.Request) -> web.Response:
        prompt_id = request.match_info["prompt_id"]
        graph = self._graphs.get(prompt_id)
        if graph is None:
            return web.json_response({})
        if self.execution_error is not None:
            return web.json_response(
                {
                    prompt_id: {
                        "outputs": {},
                        "status": {
                            "status_str": "error",
                            "completed": False,
                            "messages": [["execution_error", {"exception_message": self.execution_error}]],
                        },
                    }
                }
            )
        polls = self._polls.get(prompt_id, 0) + 1
        self._polls[prompt_id] = polls
        if polls < POLLS_BEFORE_OUTPUT:
            return web.json_response({})
        width, height = self._latent_size(graph)
        filename = f"unwritten-{prompt_id}.png"
        path = self.output_dir / filename
        info = PngImagePlugin.PngInfo()
        info.add_text("prompt", "a quiet pier at dusk")
        Image.new("RGB", (width, height), (110, 120, 130)).save(path, "PNG", pnginfo=info)
        self.output_files.append(path)
        return web.json_response(
            {
                prompt_id: {
                    "outputs": {"8": {"images": [{"filename": filename, "subfolder": "", "type": "output"}]}},
                    "status": {"status_str": "success", "completed": True, "messages": []},
                }
            }
        )

    async def _interrupt(self, request: web.Request) -> web.Response:
        self.interrupts += 1
        return web.json_response({})

    async def _system_stats(self, request: web.Request) -> web.Response:
        return web.json_response({"system": {"os": "fake"}, "devices": []})


def create_fake_app(output_dir: Path) -> tuple[web.Application, FakeComfy]:
    fake = FakeComfy(output_dir)
    return fake.app(), fake
