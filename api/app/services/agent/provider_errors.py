from openai import APIStatusError


def provider_error_code(error: Exception) -> str:
    if not isinstance(error, APIStatusError):
        return type(error).__name__
    response = error.response
    detail = ""
    try:
        payload = error.body if isinstance(error.body, dict) else response.json()
        provider_error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(provider_error, dict):
            detail = str(
                provider_error.get("code")
                or provider_error.get("type")
                or provider_error.get("message")
                or ""
            )
        elif provider_error:
            detail = str(provider_error)
    except (ValueError, TypeError):
        detail = ""
    normalized = "_".join(detail.strip().split())[:300]
    return f"provider_http_{error.status_code}{f':{normalized}' if normalized else ''}"
