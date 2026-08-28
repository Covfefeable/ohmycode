from dataclasses import dataclass
from uuid import UUID

from openai import APIStatusError, OpenAI

from .config import MODEL_REQUEST_TIMEOUT_SECONDS, MODEL_STREAM_ATTEMPTS


@dataclass(frozen=True)
class PreparedCompletion:
    run_id: UUID
    conversation_id: UUID
    endpoint: str
    api_key: str
    context_length: int
    payload: dict
    initial_answer: str = ""
    initial_reasoning: str = ""


def _base_url(endpoint: str) -> str:
    suffix = "/chat/completions"
    return endpoint[: -len(suffix)] if endpoint.endswith(suffix) else endpoint


def _payload(chunk: object) -> dict:
    if isinstance(chunk, dict):
        return chunk
    to_dict = getattr(chunk, "to_dict", None)
    if callable(to_dict):
        value = to_dict()
        if isinstance(value, dict):
            return value
    raise TypeError("invalid_provider_chunk")


def provider_payloads(prepared: PreparedCompletion):
    request_payload = dict(prepared.payload)
    with OpenAI(
        api_key=prepared.api_key,
        base_url=_base_url(prepared.endpoint),
        timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
        max_retries=max(0, MODEL_STREAM_ATTEMPTS - 1),
    ) as client:
        try:
            stream = client.chat.completions.create(**request_payload)
        except APIStatusError as error:
            if error.status_code != 400 or "stream_options" not in request_payload:
                raise
            request_payload.pop("stream_options")
            stream = client.chat.completions.create(**request_payload)
        for chunk in stream:
            yield _payload(chunk)
