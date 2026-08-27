from dataclasses import dataclass

from ..services.errors import ServiceError


@dataclass(frozen=True)
class DeviceContext:
    id: str
    name: str


def validate_device(device_id: str, device_name: str) -> DeviceContext:
    normalized_id = device_id.strip()[:64]
    normalized_name = device_name.strip()[:255]
    if not normalized_id or not normalized_name:
        raise ServiceError("device_required", 422)
    return DeviceContext(id=normalized_id, name=normalized_name)
