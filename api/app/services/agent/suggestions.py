from uuid import UUID

from ...extensions import db
from ...models import AgentRun, Conversation, ModelConfiguration
from ..conversations import get_conversation
from ..model_completion import AuxiliaryCompletion, auxiliary_completion
from ..settings import get_model_configuration
from ..settings.background_tasks import (
    background_reasoning_effort,
    background_task_settings,
    configured_model,
)
from .prompts import SUGGESTION_INSTRUCTIONS, TITLE_INSTRUCTIONS
from .runs import append_event

_TITLE_TIMEOUT_SECONDS = 20
_MAX_INPUT_CHARS = 2000
_MAX_TITLE_LENGTH = 200
_MAX_SUGGESTION_LENGTH = 200
_MAX_SUGGESTIONS = 3


def _clean_title(raw: str | None) -> str | None:
    if not isinstance(raw, str) or not raw.strip():
        return None
    line = raw.splitlines()[0].strip().strip('"').strip("'").strip()
    line = line.strip("。.；;，,")
    return (
        line[:_MAX_TITLE_LENGTH]
        if line and line.casefold() not in {"none", "null", "undefined"}
        else None
    )


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
    """Replace a provisional or invalid title using the first user message.

    Best-effort: any LLM/transport failure leaves the existing title untouched so the
    agent run is never blocked by titling.
    """
    user_messages = [message for message in conversation.messages if message.role == "user"]
    if not user_messages:
        return
    provisional = user_messages[0].content.replace("\n", " ")[:60]
    invalid_title = _clean_title(conversation.title) is None
    if invalid_title:
        conversation.title = provisional if _clean_title(provisional) else "New conversation"
    if (
        len(user_messages) > 1
        and _clean_title(conversation.title)
        and conversation.title not in {"New conversation", provisional}
    ):
        return
    cached = _event_payload(run, "conversation.title.generated") if run else None
    if cached and _clean_title(cached.get("title")):
        if invalid_title:
            conversation.title = _clean_title(cached["title"])
            db.session.commit()
        return
    completion = auxiliary_completion(
        configuration,
        TITLE_INSTRUCTIONS,
        f"<user-request>\n{user_messages[0].content[:_MAX_INPUT_CHARS]}\n</user-request>",
        timeout=_TITLE_TIMEOUT_SECONDS,
        max_tokens=2048,
    )
    title = _clean_title(completion.content if completion else None)
    if title:
        conversation.title = title
    if run:
        _record_auxiliary_usage(run, completion)
        append_event(
            run,
            "conversation.title.generated" if title else "conversation.title.failed",
            {"title": title},
        )
    if title or run or invalid_title:
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


def _suggestion_prompt(messages: list) -> str | None:
    user_messages = [message for message in messages if message.role == "user"][-10:]
    last_assistant = next(
        (message for message in reversed(messages) if message.role == "assistant"), None
    )
    if not user_messages or not last_assistant:
        return None
    questions = "\n".join(
        f"{index}. {message.content[:_MAX_INPUT_CHARS]}"
        for index, message in enumerate(user_messages, start=1)
    )
    return (
        f"Recent user questions (oldest to newest):\n{questions}\n\n"
        f"Latest agent reply:\n{last_assistant.content[:_MAX_INPUT_CHARS]}"
    )


def generate_followup_suggestions(user_id: UUID, conversation_id: UUID) -> list[str]:
    """Generate follow-ups from the latest ten user questions and last agent reply."""
    conversation = get_conversation(user_id, conversation_id)
    task_settings = background_task_settings(user_id)
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
    configuration = configured_model(user_id, task_settings.suggestions_model_id) or configuration
    if not configuration or not run:
        return []
    maybe_rename_new_conversation(conversation, configuration, run)
    if not task_settings.suggestions_enabled:
        db.session.commit()
        return []
    cached = _event_payload(run, "conversation.suggestions.generated")
    if cached is not None:
        suggestions = cached.get("suggestions")
        return [str(item) for item in suggestions] if isinstance(suggestions, list) else []
    prompt = _suggestion_prompt(messages)
    if not prompt:
        return []
    completion = auxiliary_completion(
        configuration,
        SUGGESTION_INSTRUCTIONS,
        prompt,
        reasoning_effort=background_reasoning_effort(task_settings, "suggestions", configuration),
    )
    suggestions = _parse_suggestions(completion.content if completion else None)
    _record_auxiliary_usage(run, completion)
    append_event(run, "conversation.suggestions.generated", {"suggestions": suggestions})
    db.session.commit()
    return suggestions
