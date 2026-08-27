import json
import time
from dataclasses import dataclass
from uuid import UUID

import httpx

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


def sse_json_payloads(lines):
    data_lines: list[str] = []

    def decode_event():
        if not data_lines:
            return None
        data = "\n".join(data_lines).strip()
        if not data or data == "[DONE]":
            data_lines.clear()
            return None
        payload = json.loads(data)
        data_lines.clear()
        return payload

    for line in lines:
        if line == "":
            payload = decode_event()
            if payload is not None:
                yield payload
            continue
        if line.startswith("data:"):
            if data_lines:
                try:
                    payload = decode_event()
                except json.JSONDecodeError:
                    payload = None
                else:
                    if payload is not None:
                        yield payload
            data_lines.append(line[5:].lstrip())
    payload = decode_event()
    if payload is not None:
        yield payload


def provider_payloads(prepared: PreparedCompletion):
    request_payload = prepared.payload
    for attempt in range(MODEL_STREAM_ATTEMPTS):
        meaningful_output = False
        try:
            with httpx.stream(
                "POST",
                prepared.endpoint,
                headers={
                    "Authorization": f"Bearer {prepared.api_key}",
                    "Content-Type": "application/json",
                },
                json=request_payload,
                timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
            ) as provider_response:
                provider_response.raise_for_status()
                for parsed in sse_json_payloads(provider_response.iter_lines()):
                    choice = (parsed.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    message = choice.get("message") or {}
                    if (
                        delta.get("content")
                        or delta.get("reasoning_content")
                        or delta.get("reasoning")
                        or delta.get("tool_calls")
                        or choice.get("text")
                        or message.get("content")
                        or message.get("tool_calls")
                    ):
                        meaningful_output = True
                    yield parsed
            if meaningful_output:
                return
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 400 and "stream_options" in request_payload:
                request_payload = {
                    key: value
                    for key, value in request_payload.items()
                    if key != "stream_options"
                }
                continue
            retryable = error.response.status_code == 429 or error.response.status_code >= 500
            if meaningful_output or not retryable or attempt == MODEL_STREAM_ATTEMPTS - 1:
                raise
            time.sleep(min(2**attempt, 4))
        except (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadError,
            httpx.ReadTimeout,
            httpx.RemoteProtocolError,
        ):
            if meaningful_output or attempt == MODEL_STREAM_ATTEMPTS - 1:
                raise
