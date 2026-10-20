"""Image budgeting and text-only history projection, without changing stored results."""

import base64
import binascii
import math
from io import BytesIO

from PIL import Image


def image_tokens(image_url: dict) -> int:
    # A tile-based estimate, not a provider billing rule. Actual prompt_tokens
    # still calibrate the request budget; never count encoded bytes as text.
    if image_url.get("detail") == "low":
        return 85
    url = image_url.get("url", "")
    if not url.startswith("data:image/"):
        return 1445  # Unknown remote dimensions; do not fetch images to count tokens.
    try:
        with Image.open(BytesIO(base64.b64decode(url.split(",", 1)[1]))) as image:
            width, height = image.size
    except (binascii.Error, IndexError, OSError, ValueError, Image.DecompressionBombError):
        return 1445
    scale = min(1, 2048 / max(width, height), 768 / min(width, height))
    tiles = math.ceil(width * scale / 512) * math.ceil(height * scale / 512)
    return 85 + 170 * tiles


def text_only_images(value: object) -> object:
    """Keep references and metadata in history, not image bytes or vision parts."""
    if isinstance(value, list):
        return [text_only_images(item) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get("type") == "image_url":
        url = value["image_url"]["url"]
        return {
            "type": "text",
            "text": "[Image content omitted from history]" if url.startswith("data:") else url,
        }
    if value.get("type") == "image" and isinstance(value.get("mimeType"), str):
        return {
            **{key: text_only_images(item) for key, item in value.items() if key != "data"},
            "imageOmitted": True,
        }
    return {
        key: text_only_images(item)
        for key, item in value.items()
        if not (key == "dataUrl" and value.get("contentKind") == "image")
    }
