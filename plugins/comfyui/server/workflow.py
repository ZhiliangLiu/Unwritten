import copy
import re
import secrets
from typing import Any

REFERENCE_PATTERN = re.compile(r"\{\{ref:(\d+)\}\}")


def _set_binding(graph: dict[str, Any], binding: list[str], value: Any) -> None:
    node_id, input_name = binding
    graph[node_id]["inputs"][input_name] = value


def fill(
    template: dict[str, Any],
    binding: dict[str, Any],
    request: dict[str, Any],
    ref_files: list[str],
) -> tuple[dict[str, Any], int]:
    graph = copy.deepcopy(template)
    prompt = REFERENCE_PATTERN.sub(lambda match: f"<image{match.group(1)}>", request["prompt"])
    seed = request.get("seed")
    if seed is None:
        seed = secrets.randbelow(2**31)
    _set_binding(graph, binding["prompt"], prompt)
    _set_binding(graph, binding["seed"], seed)
    _set_binding(graph, binding["width"], request["width"])
    _set_binding(graph, binding["height"], request["height"])

    slots = binding["references"]
    if len(ref_files) > len(slots):
        raise ValueError("not enough reference slots")
    for slot, file_name in zip(slots, ref_files, strict=False):
        graph[slot["loadImage"]]["inputs"]["image"] = file_name
        encoder_node, encoder_input = slot["encoderInput"]
        graph[encoder_node]["inputs"][encoder_input] = [slot["loadImage"], 0]

    for slot in slots[len(ref_files) :]:
        graph.pop(slot["loadImage"], None)
        encoder_node, encoder_input = slot["encoderInput"]
        graph.get(encoder_node, {}).get("inputs", {}).pop(encoder_input, None)

    return graph, seed
