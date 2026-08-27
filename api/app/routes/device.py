from urllib.parse import unquote

from flask import request

from ..services.devices import DeviceContext, validate_device


def current_device() -> DeviceContext:
    return validate_device(
        request.headers.get("X-OhMyCode-Device-Id", ""),
        unquote(request.headers.get("X-OhMyCode-Device-Name", "")),
    )
