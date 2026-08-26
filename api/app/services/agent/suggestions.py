from dataclasses import dataclass
from uuid import UUID

import httpx

from ...extensions import db
from ...models import AgentRun, Conversation, ModelConfiguration
from ..conversations import get_conversation
from ..model_credentials import decrypt_api_key
from ..settings import get_model_configuration
from .prompts import SUGGESTION_INSTRUCTIONS, TITLE_INSTRUCTIONS
from .runs import append_event

_AUX_TIMEOUT_SECONDS = 30
_TITLE_TIMEOUT_SECONDS = 20
_MAX_INPUT_CHARS = 2000
_MAX_TITLE_LENGTH = 200
_MAX_SUGGESTION_LENGTH = 200
_MAX_SUGGESTIONS = 3


@dataclass(frozen=True)
class AuxiliaryCompletion:
    content: str
    input_tokens: int
    output_tokens: int


def _aux_completion(
    configuration: ModelConfiguration,
    system_prompt: str,
    user_prompt: str,
    *,
    timeout: float = _AUX_TIMEOUT_SECONDS,
) -> AuxiliaryCompletion | None:
    try:
        response = httpx.post(
            f"{configuration.base_url.rstrip('/')}/chat/completions",
            headers={
                "Authorization": f"Bearer {decrypt_api_key(configuration.api_key_encrypted)}",
                "Content-Type": "application/json",
            },
            json={
                "model": configuration.model,
                "stream": False,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
            },
            timeout=timeout,
        )
        response.raise_for_status()
        payload = response.json()
        content = str(payload["choices"][0]["message"]["content"]).strip()
        if not content:
            return None
        usage = payload.get("usage") if isinstance(payload, dict) else None
        usage = usage if isinstance(usage, dict) else {}
        return AuxiliaryCompletion(
            content=content,
            input_tokens=int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0),
            output_tokens=int(
                usage.get("completion_tokens") or usage.get("output_tokens") or 0
            ),
        )
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError):
        return None


def _clean_title(raw: str | None) -> str | None:
    if not raw:
        return None
    line = raw.splitlines()[0].strip().strip('"').strip("'").strip()
    line = line.strip("。.；;，,")
    return line[:_MAX_TITLE_LENGTH] or None


def _parse_suggestions(raw: str | None) -> list[str]:
    if not raw:
        return []
    suggestions: list[str] = []
    for line in raw.splitlines():
        cleaned = line.strip().lstrip("-•*·0123456789.）)、 ").strip()
        cleaned = cleaned.strip('"').strip("'").strip()
        if cleaned:
            suggestions.append(cleaned[:_MAX_SUGGESTION_LENGTH])
    return suggestions[:_MAX_SUGGESTIONS]


def _record_auxiliary_usage(run: AgentRun, completion: AuxiliaryCompletion | None) -> None:
    if not completion:
        return
    run.input_tokens = (run.input_tokens or 0) + completion.input_tokens
    run.output_tokens = (run.output_tokens or 0) + completion.output_tokens


def _event_payload(run: AgentRun, event_type: str) -> dict | None:
    event = next((item for item in reversed(run.events) if item.event_type == event_type), None)
    return event.payload if event else None


def maybe_rename_new_conversation(
    conversation: Conversation, configuration: ModelConfiguration, run: AgentRun | None = None
) -> None:
    """Rename a brand-new conversation from its first user message.

    Best-effort: any LLM/transport failure leaves the existing title untouched so the
    agent run is never blocked by titling.
    """
    user_messages = [message for message in conversation.messages if message.role == "user"]
    if len(user_messages) != 1:
        return
    if run and _event_payload(run, "conversation.title.generated") is not None:
        return
    completion = _aux_completion(
        configuration,
        TITLE_INSTRUCTIONS,
        f"User request:\n{user_messages[0].content[:_MAX_INPUT_CHARS]}",
        timeout=_TITLE_TIMEOUT_SECONDS,
    )
    title = _clean_title(completion.content if completion else None)
    if title:
        conversation.title = title
    if run:
        _record_auxiliary_usage(run, completion)
        append_event(run, "conversation.title.generated", {"title": title})
    if title or run:
        db.session.commit()


def _configuration_for(
    conversation_id: UUID, user_id: UUID
) -> tuple[ModelConfiguration | None, AgentRun | None]:
    run = db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.conversation_id == conversation_id)
        .order_by(AgentRun.started_at.desc())
    )
    configuration = (
        db.session.get(ModelConfiguration, run.model_configuration_id)
        if run and run.model_configuration_id
        else None
    )
    if not configuration:
        configuration = get_model_configuration(user_id, None)
    return configuration, run


def generate_followup_suggestions(user_id: UUID, conversation_id: UUID) -> list[str]:
    """Generate 2-3 short follow-up suggestions from the latest user+assistant pair."""
    conversation = get_conversation(user_id, conversation_id)
    messages = list(conversation.messages)
    last_user_index = next(
        (index for index in range(len(messages) - 1, -1, -1) if messages[index].role == "user"),
        None,
    )
    if last_user_index is None:
        return []
    last_user = messages[last_user_index]
    last_assistant = next(
        (
            message
            for message in reversed(messages[last_user_index + 1 :])
            if message.role == "assistant"
        ),
        None,
    )
    if not last_user or not last_assistant:
        return []
    configuration, run = _configuration_for(conversation_id, user_id)
    if not configuration or not run:
        return []
    cached = _event_payload(run, "conversation.suggestions.generated")
    if cached is not None:
        suggestions = cached.get("suggestions")
        return [str(item) for item in suggestions] if isinstance(suggestions, list) else []
    maybe_rename_new_conversation(conversation, configuration, run)
    prompt = (
        f"User request:\n{last_user.content[:_MAX_INPUT_CHARS]}\n\n"
        f"Agent reply:\n{last_assistant.content[:_MAX_INPUT_CHARS]}"
    )
    completion = _aux_completion(configuration, SUGGESTION_INSTRUCTIONS, prompt)
    suggestions = _parse_suggestions(completion.content if completion else None)
    _record_auxiliary_usage(run, completion)
    append_event(run, "conversation.suggestions.generated", {"suggestions": suggestions})
    db.session.commit()
    return suggestions
