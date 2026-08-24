from ...extensions import db
from ...models import AgentRun, Conversation, Message, Project


def serialize_message(message: Message) -> dict:
    run = db.session.get(AgentRun, message.agent_run_id) if message.agent_run_id else None
    duration_ms = None
    if run and run.started_at and run.completed_at:
        duration_ms = max(0, round((run.completed_at - run.started_at).total_seconds() * 1000))
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
        "reasoning": message.reasoning,
        "activity": message.activity,
        "agentDurationMs": duration_ms,
        "createdAt": message.created_at.isoformat() if message.created_at else None,
    }


def serialize_conversation(conversation: Conversation, include_messages: bool = False) -> dict:
    result = {
        "id": str(conversation.id),
        "title": conversation.title,
        "createdAt": conversation.created_at.isoformat() if conversation.created_at else None,
    }
    if include_messages:
        result["messages"] = [serialize_message(message) for message in conversation.messages]
    return result


def serialize_project(project: Project) -> dict:
    return {
        "id": str(project.id),
        "name": project.name,
        "path": project.path,
        "conversations": [serialize_conversation(item) for item in project.conversations],
    }
