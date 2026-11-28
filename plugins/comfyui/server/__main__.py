import logging
from pathlib import Path

from aiohttp import web

from .app import create_app
from .config import load_config
from .manifest import Manifest

WORKFLOWS_DIR = Path(__file__).resolve().parent.parent / "workflows"


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config = load_config()
    manifest = Manifest.load(WORKFLOWS_DIR, gpu_name=config.gpu_name)
    app = create_app(config, manifest)
    web.run_app(app, host="127.0.0.1", port=config.port, print=None)


if __name__ == "__main__":
    main()
