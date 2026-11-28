import copy
import json
from pathlib import Path

from server.workflow import fill

WORKFLOWS = Path(__file__).resolve().parent / "workflows"


def _request() -> dict:
    return {"prompt": "one figure hands {{ref:1}} an umbrella to {{ref:2}}", "seed": 42, "width": 720, "height": 480}


def _template(name: str) -> dict:
    return json.loads((WORKFLOWS / name).read_text())


def _binding(name: str) -> dict:
    return json.loads((WORKFLOWS / "manifest.json").read_text())["templates"][name]


def test_unused_reference_slots_are_removed():
    template = _template("edit-best.json")
    original = copy.deepcopy(template)
    graph, seed = fill(template, _binding("edit-best"), _request(), ["first.png", "second.png"])
    load_images = [node_id for node_id, node in graph.items() if node["class_type"] == "LoadImage"]
    assert load_images == ["10", "11"]
    encoder_inputs = graph["4"]["inputs"]
    assert encoder_inputs["image_1"] == ["10", 0]
    assert encoder_inputs["image_2"] == ["11", 0]
    assert "image_3" not in encoder_inputs
    assert "image_10" not in encoder_inputs
    assert seed == 42
    assert graph["4"]["inputs"]["text"] == "one figure hands <image1> an umbrella to <image2>"
    assert template == original


def test_seed_is_generated_when_missing():
    request = _request()
    request["seed"] = None
    graph, seed = fill(_template("t2i-best.json"), _binding("t2i-best"), request, [])
    assert isinstance(seed, int)
    assert graph["2"]["inputs"]["seed"] == seed
    assert graph["1"]["inputs"]["width"] == 720
    assert graph["1"]["inputs"]["height"] == 480


def test_zero_references_removes_all_slots():
    graph, _ = fill(_template("edit-best.json"), _binding("edit-best"), _request(), [])
    assert not [node for node in graph.values() if node["class_type"] == "LoadImage"]
    assert not [name for name in graph["4"]["inputs"] if name.startswith("image_")]
