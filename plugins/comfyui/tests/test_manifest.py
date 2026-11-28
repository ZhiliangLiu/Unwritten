import json
import shutil
from pathlib import Path

from server.config import load_config
from server.manifest import Manifest

WORKFLOWS = Path(__file__).resolve().parent / "workflows"
TEST_GPU = "Fake GPU 24GB"


def test_resolutions_follow_the_gpu_name():
    known = Manifest.load(WORKFLOWS, gpu_name=TEST_GPU)
    resolutions = known.info(True, None, 0)["capabilities"]["resolutions"]
    assert resolutions == {
        "3:2": {"720": {"width": 1088, "height": 720}},
        "3:4": {"720": {"width": 720, "height": 960}},
    }
    assert known.size_allowed("3:2", 1088, 720)
    assert not known.size_allowed("3:2", 1200, 720)

    unknown = Manifest.load(WORKFLOWS, gpu_name="Some Other GPU")
    assert unknown.info(True, None, 0)["capabilities"]["resolutions"] == {}


def test_gpu_name_env_override(tmp_path):
    environment = {
        "UNWRITTEN_IMAGE_TOKEN": "test-token-0123456789abcdef0123456789abcdef",
        "COMFY_INPUT_DIR": str(tmp_path / "input"),
        "COMFY_OUTPUT_DIR": str(tmp_path / "output"),
        "UNWRITTEN_GPU_NAME": TEST_GPU,
    }
    known = Manifest.load(WORKFLOWS, gpu_name=load_config(environment).gpu_name)
    assert known.info(True, None, 0)["capabilities"]["resolutions"] != {}

    environment["UNWRITTEN_GPU_NAME"] = "Some Other GPU"
    unknown = Manifest.load(WORKFLOWS, gpu_name=load_config(environment).gpu_name)
    assert unknown.info(True, None, 0)["capabilities"]["resolutions"] == {}


def test_negative_prompt_needs_every_template(tmp_path):
    directory = tmp_path / "workflows"
    shutil.copytree(WORKFLOWS, directory)
    data = json.loads((directory / "manifest.json").read_text())
    for binding in data["templates"].values():
        binding["negativePromptEffective"] = True
    (directory / "manifest.json").write_text(json.dumps(data))
    manifest = Manifest.load(directory, gpu_name=TEST_GPU)
    assert manifest.info(True, None, 0)["capabilities"]["negativePrompt"] is True

    data["templates"]["edit-fast"]["negativePromptEffective"] = False
    (directory / "manifest.json").write_text(json.dumps(data))
    manifest = Manifest.load(directory, gpu_name=TEST_GPU)
    assert manifest.info(True, None, 0)["capabilities"]["negativePrompt"] is False


def test_info_reports_the_expected_capabilities(manifest):
    info = manifest.info(True, None, 3)
    assert info["protocol"] == "unwritten-image/1"
    assert info["implementation"]["name"] == "ComfyUI"
    assert info["model"] == "Qwen-Image-2.1"
    assert info["queue"] == {"pending": 3, "max": 8}
    assert info["capabilities"]["qualities"] == ["fast", "best"]
    assert info["capabilities"]["aspects"] == ["3:2", "3:4"]
    assert info["capabilities"]["maxReferences"] == 10
    assert info["capabilities"]["seed"] is True
