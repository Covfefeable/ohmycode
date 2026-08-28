from collections.abc import Iterator
from uuid import UUID

from ..extensions import db
from ..models import AgentRun, Conversation, Project
from .agent import (
    recover_completion,
    resume_completion,
    stream_completion,
    stream_prepare_completion,
)
from .agent.provider_stream import PreparedCompletion
from .agent.runs import cancel_run
from .agent.tools import (
    LOAD_CAPABILITY_TOOL,
    READ_TOOL_RESULT_TOOL,
    SEARCH_CAPABILITIES_TOOL,
    SEARCH_TOOL_RESULT_TOOL,
    UPDATE_TASKS_TOOL,
)
from .conversations import create_conversation, delete_conversation, get_conversation
from .errors import ServiceError

MOBILE_DEVICE_ID = "mobile"
MOBILE_PROJECT_PATH = "ohmycode://mobile/conversations"
MOBILE_SYSTEM_INSTRUCTIONS = """You are OhMyCode's mobile assistant.
Answer clearly and directly using the conversation context. You do not have access to the
user's filesystem, terminal, desktop workspace, attachments, local MCP servers, or local Skills.
You may search and load capabilities supported by this client: enabled remote HTTP MCP servers
and synchronized Skills. Capability tools are only available after you load the corresponding
capability. When a long tool response contains resultRef, search or page through that complete
result instead of assuming its middle is unavailable. Never claim that you executed commands or
changed local files. If a request requires local code execution, explain that it should be
continued in the OhMyCode desktop application."""
MOBILE_TOOLS = [
    UPDATE_TASKS_TOOL,
    SEARCH_CAPABILITIES_TOOL,
    LOAD_CAPABILITY_TOOL,
    READ_TOOL_RESULT_TOOL,
    SEARCH_TOOL_RESULT_TOOL,
]


def _mobile_project(user_id: UUID) -> Project:
    project = db.session.scalar(
        db.select(Project).where(
            Project.user_id == user_id,
            Project.kind == "mobile",
            Project.path == MOBILE_PROJECT_PATH,
        )
    )
    if project:
        return project
    project = Project(
        user_id=user_id,
        device_id=MOBILE_DEVICE_ID,
        device_name="OhMyCode Mobile",
        name="Mobile",
        path=MOBILE_PROJECT_PATH,
        kind="mobile",
    )
    db.session.add(project)
    db.session.commit()
    return project


def _owned_mobile_conversation(user_id: UUID, conversation_id: UUID) -> Conversation:
    conversation = db.session.scalar(
        db.select(Conversation)
        .join(Project)
        .where(
            Conversation.id == conversation_id,
            Project.user_id == user_id,
            Project.kind == "mobile",
        )
    )
    if not conversation:
        raise ServiceError("not_found", 404)
    return conversation


def list_mobile_conversations(user_id: UUID) -> list[Conversation]:
    return list(
        db.session.scalars(
            db.select(Conversation)
            .join(Project)
            .where(Project.user_id == user_id, Project.kind == "mobile")
            .order_by(Conversation.updated_at.desc())
        )
    )


def create_mobile_conversation(user_id: UUID, payload: dict) -> Conversation:
    return create_conversation(user_id, _mobile_project(user_id).id, payload)


def get_mobile_conversation(user_id: UUID, conversation_id: UUID) -> Conversation:
    _owned_mobile_conversation(user_id, conversation_id)
    return get_conversation(user_id, conversation_id)


def delete_mobile_conversation(user_id: UUID, conversation_id: UUID) -> None:
    _owned_mobile_conversation(user_id, conversation_id)
    delete_conversation(user_id, conversation_id)


def cancel_mobile_run(user_id: UUID, run_id: UUID, partial_message: str = "") -> None:
    owned = db.session.scalar(
        db.select(AgentRun)
        .join(Conversation)
        .join(Project)
        .where(
            AgentRun.id == run_id,
            Project.user_id == user_id,
            Project.kind == "mobile",
        )
    )
    if not owned:
        raise ServiceError("not_found", 404)
    cancel_run(user_id, run_id, partial_message)


def get_owned_mobile_run(user_id: UUID, run_id: UUID) -> AgentRun:
    run = db.session.scalar(
        db.select(AgentRun)
        .join(Conversation)
        .join(Project)
        .where(
            AgentRun.id == run_id,
            Project.user_id == user_id,
            Project.kind == "mobile",
        )
    )
    if not run:
        raise ServiceError("not_found", 404)
    return run


def resume_mobile_run(
    user_id: UUID, run_id: UUID, results: list[dict]
) -> PreparedCompletion | list[dict]:
    get_owned_mobile_run(user_id, run_id)
    return resume_completion(
        user_id,
        run_id,
        results,
        tools_override=MOBILE_TOOLS,
        system_instructions=MOBILE_SYSTEM_INSTRUCTIONS,
    )


def recover_mobile_run(
    user_id: UUID,
    run_id: UUID,
    partial_content: str,
    partial_reasoning: str,
    results: list[dict],
) -> PreparedCompletion | list[dict]:
    get_owned_mobile_run(user_id, run_id)
    return recover_completion(
        user_id,
        run_id,
        partial_content=partial_content,
        partial_reasoning=partial_reasoning,
        results=results,
        tools_override=MOBILE_TOOLS,
        system_instructions=MOBILE_SYSTEM_INSTRUCTIONS,
    )


def stream_mobile_chat(
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    model_id: str | None,
    turn_id: UUID | None,
) -> Iterator[dict]:
    _owned_mobile_conversation(user_id, conversation_id)
    preparation = stream_prepare_completion(
        user_id,
        conversation_id,
        content,
        model_id,
        None,
        turn_id=turn_id,
        tools_override=MOBILE_TOOLS,
        system_instructions=MOBILE_SYSTEM_INSTRUCTIONS,
    )
    while True:
        try:
            yield next(preparation)
        except StopIteration as completed:
            prepared = completed.value
            break
    yield from stream_completion(prepared)
