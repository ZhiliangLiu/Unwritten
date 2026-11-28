from io import BytesIO
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from .config import MAX_REFERENCE_EDGE, WEBP_QUALITY


class InvalidImage(Exception):
    pass


def load_reference(data: bytes) -> Image.Image:
    try:
        with Image.open(BytesIO(data)) as probe:
            probe.verify()
        with Image.open(BytesIO(data)) as source:
            source.load()
            image = source.convert("RGB")
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise InvalidImage("invalid image") from error
    if image.width > MAX_REFERENCE_EDGE or image.height > MAX_REFERENCE_EDGE:
        raise InvalidImage("image too large")
    return image


def encode_result(path: Path) -> bytes:
    with Image.open(path) as image:
        image.load()
        buffer = BytesIO()
        image.save(buffer, "WEBP", quality=WEBP_QUALITY)
    return buffer.getvalue()
