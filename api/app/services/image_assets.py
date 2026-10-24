"""Private image objects; persistent JSON contains references, never encoded pixels."""

import base64
import binascii
import hashlib
import re
from io import BytesIO
from uuid import UUID

from PIL import Image

from .errors import ServiceError
from .object_storage import get_object, put_object

MAX_IMAGE_BYTES = 16 * 1024 * 1024
REFERENCE = re.compile(r"^ohmycode-image://([0-9a-f-]{36})/([0-9a-f]{64})$")
MIME_TYPES = {
    "PNG": "image/png",
    "JPEG": "image/jpeg",
    "WEBP": "image/webp",
    "GIF": "image/gif",
    "BMP": "image/bmp",
}


def save_image(user_id: UUID, content: bytes) -> dict:
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise ServiceError("invalid_image_size", 422)
    try:
        with Image.open(BytesIO(content)) as image:
            mime_type = MIME_TYPES[image.format]
            width, height = image.size
            image.verify()
    except (OSError, ValueError, KeyError, Image.DecompressionBombError) as error:
        raise ServiceError("invalid_image", 422) from error
    digest = hashlib.sha256(content).hexdigest()
    put_object(f"images/{user_id}/{digest}", content, mime_type)
    return {
        "imageRef": f"ohmycode-image://{user_id}/{digest}",
        "mimeType": mime_type,
        "width": width,
        "height": height,
    }


def read_image(user_id: UUID, digest: str) -> tuple[bytes, str]:
    if not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise ServiceError("image_not_found", 404)
    return get_object(f"images/{user_id}/{digest}")


def _validate_reference(user_id: UUID, reference: object) -> None:
    match = REFERENCE.fullmatch(str(reference))
    if not match or match[1] != str(user_id):
        raise ServiceError("invalid_image_reference", 422)


def _save_encoded(user_id: UUID, encoded: str) -> dict:
    try:
        content = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise ServiceError("invalid_image", 422) from error
    return save_image(user_id, content)


def store_images(user_id: UUID, value: object) -> object:
    if isinstance(value, list):
        return [store_images(user_id, item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: store_images(user_id, item) for key, item in value.items()}
    reference = result.get("imageRef")
    if reference is not None:
        _validate_reference(user_id, reference)
    if result.get("type") == "image_url" and isinstance(result.get("image_url"), dict):
        image = result["image_url"]
        url = image.get("url", "")
        if isinstance(url, str) and url.startswith("ohmycode-image://"):
            _validate_reference(user_id, url)
        elif isinstance(url, str) and url.startswith("data:image/") and ";base64," in url:
            asset = _save_encoded(user_id, url.split(";base64,", 1)[1])
            result["image_url"] = {**image, "url": asset["imageRef"]}
    encoded = None
    field = None
    if result.get("contentKind") == "image" and isinstance(result.get("dataUrl"), str):
        field = "dataUrl"
        url = result[field]
        if url.startswith("data:image/") and ";base64," in url:
            encoded = url.split(";base64,", 1)[1]
    elif result.get("type") == "image" and isinstance(result.get("data"), str):
        field, encoded = "data", result["data"]
    elif str(result.get("mimeType", "")).startswith("image/") and isinstance(
        result.get("blob"), str
    ):
        field, encoded = "blob", result["blob"]
    if encoded is not None:
        result.pop(field)
        result.update(_save_encoded(user_id, encoded))
    return result


def hydrate_images(value: object) -> object:
    """Resolve model vision parts only in memory immediately before provider I/O."""
    if isinstance(value, list):
        return [hydrate_images(item) for item in value]
    if not isinstance(value, dict):
        return value
    if value.get("type") == "image_url":
        image = value["image_url"]
        match = REFERENCE.fullmatch(str(image.get("url", "")))
        if match:
            content, mime_type = read_image(UUID(match[1]), match[2])
            return {
                **value,
                "image_url": {
                    **image,
                    "url": f"data:{mime_type};base64,{base64.b64encode(content).decode()}",
                },
            }
    return {key: hydrate_images(item) for key, item in value.items()}
