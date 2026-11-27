"""Shared non-streaming OpenAI-compatible requests and response parsing."""

from dataclasses import dataclass

import httpx

from ..models import ModelConfiguration
from .model_credentials import decrypt_api_key
from .model_reasoning import reasoning_parameters


@dataclass(frozen=True)
class AuxiliaryCompletion:
    content: str
    input_tokens: int
    output_tokens: int


def post_completion(
    configuration: ModelConfiguration,
    messages: list[dict],
    *,
    timeout: float,
    max_tokens: int | None = None,
    reasoning_effort: str = "",
    response_format: dict | None = None,
) -> httpx.Response:
    payload = {
        "model": configuration.model,
        "stream": False,
        "messages": messages,
        **reasoning_parameters(configuration, reasoning_effort),
    }
    if max_tokens is not None:
        payload["max_tokens"] = max_tokens
    if response_format is not None:
        payload["response_format"] = response_format
    response = httpx.post(
        f"{configuration.base_url.rstrip('/')}/chat/completions",
        headers={
            "Authorization": f"Bearer {decrypt_api_key(configuration.api_key_encrypted)}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=timeout,
    )
    response.raise_for_status()
    return response


def completion_text(payload: dict) -> str:
    choice = payload["choices"][0]
    content = choice["message"].get("content")
    if (
        not isinstance(content, str)
        or not content.strip()
        or choice.get("finish_reason") == "length"
    ):
        raise ValueError("incomplete_completion")
    return content.strip()


def auxiliary_completion(
    configuration: ModelConfiguration,
    system_prompt: str,
    user_prompt: str,
    *,
    timeout: float = 30,
    max_tokens: int | None = None,
    reasoning_effort: str = "",
) -> AuxiliaryCompletion | None:
    try:
        response = post_completion(
            configuration,
            [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            timeout=timeout,
            max_tokens=max_tokens,
            reasoning_effort=reasoning_effort,
        )
        payload = response.json()
        content = completion_text(payload)
        usage = payload.get("usage")
        usage = usage if isinstance(usage, dict) else {}
        return AuxiliaryCompletion(
            content=content,
            input_tokens=int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
            output_tokens=int(usage.get("completion_tokens") or usage.get("output_tokens") or 0),
        )
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None
