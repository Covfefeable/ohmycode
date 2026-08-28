import json

from ..errors import ServiceError

MAX_TOOLS = 500
MAX_SNAPSHOT_BYTES = 1_000_000


def validate_tool_snapshot(value: object) -> list[dict]:
    if not isinstance(value, list) or len(value) > MAX_TOOLS:
        raise ServiceError("invalid_tool_snapshot", 422)
    try:
        encoded = json.dumps(value, ensure_ascii=False)
    except (TypeError, ValueError) as error:
        raise ServiceError("invalid_tool_snapshot", 422) from error
    if len(encoded.encode("utf-8")) > MAX_SNAPSHOT_BYTES:
        raise ServiceError("tool_snapshot_too_large", 413)
    names: set[str] = set()
    snapshot: list[dict] = []
    for item in value:
        function = item.get("function") if isinstance(item, dict) else None
        name = function.get("name") if isinstance(function, dict) else None
        description = function.get("description") if isinstance(function, dict) else None
        parameters = function.get("parameters") if isinstance(function, dict) else None
        if (
            item.get("type") != "function"
            or not isinstance(name, str)
            or not name
            or len(name) > 128
            or name in names
            or not isinstance(description, str)
            or not isinstance(parameters, dict)
        ):
            raise ServiceError("invalid_tool_snapshot", 422)
        names.add(name)
        snapshot.append(item)
    return snapshot
