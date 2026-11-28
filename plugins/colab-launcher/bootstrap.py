import json
import sys
import tarfile
from pathlib import Path

ROOT = Path("/content/unwritten")
ARCHIVE = ROOT / "upload.tar"
LAUNCH = ROOT / "launch.json"


def _service_name() -> str:
    names = [path.name for path in ROOT.iterdir() if path.is_dir() and (path / "code").is_dir()]
    if len(names) != 1:
        raise SystemExit("expected exactly one service directory")
    return names[0]


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    with tarfile.open(ARCHIVE) as archive:
        archive.extractall(ROOT, filter="data")
    name = _service_name()
    sys.path.insert(0, str(ROOT / "colab"))
    sys.path.insert(0, str(ROOT / name / "code"))
    idle_minutes = json.loads(LAUNCH.read_text())["idleMinutes"]
    import unwritten_colab
    from colab_service import SERVICE

    unwritten_colab.run(SERVICE, mode="launcher", idle_minutes=idle_minutes)


main()
