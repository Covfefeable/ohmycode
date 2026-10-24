from uuid import UUID

from flask import Blueprint, Response, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.image_assets import MAX_IMAGE_BYTES, read_image, save_image

images_bp = Blueprint("images", __name__)


@images_bp.post("")
@jwt_required()
def upload_image_route():
    request.max_content_length = MAX_IMAGE_BYTES
    return save_image(UUID(get_jwt_identity()), request.get_data())


@images_bp.get("/<digest>")
@jwt_required()
def image_route(digest: str):
    content, mime_type = read_image(UUID(get_jwt_identity()), digest)
    return Response(
        content,
        mimetype=mime_type,
        headers={"Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff"},
    )
