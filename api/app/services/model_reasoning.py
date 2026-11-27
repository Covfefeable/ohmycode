"""Validate user-defined Chat Completions reasoning effort choices."""

from .errors import ServiceError


def validate_reasoning_levels(value: object) -> list[dict]:
    if not isinstance(value, list) or len(value) > 32:
        raise ServiceError("validation_error", 422)
    levels = []
    keys = set()
    for entry in value:
        if not isinstance(entry, dict):
            raise ServiceError("validation_error", 422)
        name, key = entry.get("name"), entry.get("key")
        if (
            not isinstance(name, str)
            or not name.strip()
            or len(name) > 100
            or not isinstance(key, str)
            or not key.strip()
            or len(key) > 100
            or key.strip() in keys
        ):
            raise ServiceError("validation_error", 422)
        keys.add(key.strip())
        levels.append({"name": name.strip(), "key": key.strip()})
    return levels


def reasoning_parameters(configuration, effort: object) -> dict:
    if not configuration.reasoning_enabled or effort is None or effort == "":
        return {}
    if not isinstance(effort, str) or effort not in {
        level["key"] for level in configuration.reasoning_levels
    }:
        raise ServiceError("invalid_reasoning_effort", 422)
    return {"reasoning_effort": effort}
