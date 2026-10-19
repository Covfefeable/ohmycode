from uuid import UUID

from ..extensions import db
from ..models import AgentRun, Conversation, Project
from .agent.executions import recover_execution, resume_execution, start_execution
from .agent.runs import cancel_run
from .conversations import create_conversation, delete_conversation
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
    return create_conversation(_mobile_project(user_id), payload)


def get_mobile_conversation(user_id: UUID, conversation_id: UUID) -> Conversation:
    return _owned_mobile_conversation(user_id, conversation_id)


def delete_mobile_conversation(user_id: UUID, conversation_id: UUID) -> None:
    delete_conversation(_owned_mobile_conversation(user_id, conversation_id))


def cancel_mobile_run(user_id: UUID, run_id: UUID, partial_message: object = None) -> None:
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
    user_id: UUID, run_id: UUID, results: list[dict], tool_snapshot: object
) -> UUID:
    get_owned_mobile_run(user_id, run_id)
    return resume_execution(
        user_id,
        run_id,
        results,
        tool_snapshot=tool_snapshot,
        system_instructions=MOBILE_SYSTEM_INSTRUCTIONS,
    )


def recover_mobile_run(
    user_id: UUID,
    run_id: UUID,
    results: list[dict],
    tool_snapshot: object,
) -> UUID:
    get_owned_mobile_run(user_id, run_id)
    return recover_execution(
        user_id,
        run_id,
        results=results,
        tool_snapshot=tool_snapshot,
        system_instructions=MOBILE_SYSTEM_INSTRUCTIONS,
    )


def start_mobile_chat(
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    model_id: str | None,
    turn_id: UUID | None,
    tool_snapshot: object,
) -> UUID:
    _owned_mobile_conversation(user_id, conversation_id)
    return start_execution(
        user_id,
        conversation_id,
        content,
        model_id,
        None,
        turn_id=turn_id,
        tool_snapshot=tool_snapshot,
        system_instructions=MOBILE_SYSTEM_INSTRUCTIONS,
    )
