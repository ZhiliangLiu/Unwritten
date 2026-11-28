import io

import pytest
from PIL import Image, PngImagePlugin

from server.images import InvalidImage, encode_result, load_reference


def _png_bytes(size=(8, 6)) -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", size, (10, 20, 30)).save(buffer, "PNG")
    return buffer.getvalue()


def _riff_chunks(data: bytes) -> list[bytes]:
    assert data[:4] == b"RIFF"
    assert data[8:12] == b"WEBP"
    chunks: list[bytes] = []
    offset = 12
    while offset + 8 <= len(data):
        fourcc = data[offset : offset + 4]
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        chunks.append(fourcc)
        offset += 8 + size + (size & 1)
    return chunks


def test_result_is_webp_without_metadata(tmp_path):
    source = tmp_path / "source.png"
    png_info = PngImagePlugin.PngInfo()
    png_info.add_text("prompt", "a quiet pier at dusk")
    png_info.add_text("workflow", "test")
    exif = Image.Exif()
    exif[0x0112] = 1
    Image.new("RGB", (16, 12), (90, 100, 110)).save(source, "PNG", pnginfo=png_info, exif=exif.tobytes())

    with Image.open(source) as opened:
        assert opened.info["prompt"] == "a quiet pier at dusk"
        assert "exif" in opened.info

    data = encode_result(source)
    chunks = _riff_chunks(data)
    assert b"EXIF" not in chunks
    assert b"XMP " not in chunks
    assert not {b"tEXt", b"iTXt", b"zTXt"} & set(chunks)
    with Image.open(io.BytesIO(data)) as encoded:
        assert encoded.format == "WEBP"
        assert encoded.size == (16, 12)
        assert "exif" not in encoded.info
        assert "xmp" not in encoded.info
        assert not {key for key in encoded.info if isinstance(key, str) and key.startswith("prompt")}


def test_load_reference_returns_rgb_image():
    image = load_reference(_png_bytes((9, 7)))
    assert image.mode == "RGB"
    assert image.size == (9, 7)


def test_load_reference_rejects_oversized_image():
    with pytest.raises(InvalidImage):
        load_reference(_png_bytes((4097, 1)))


def test_load_reference_rejects_garbage():
    with pytest.raises(InvalidImage):
        load_reference(b"not an image")
