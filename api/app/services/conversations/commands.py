from uuid import UUID

from ...extensions import db
from ...models import Conversation, Message
from ..errors import ServiceError
from ..projects.queries import owned_conversation, owned_project


def get_conversation(user_id: UUID, conversation_id: UUID) -> Conversation:
    conversation = owned_conversation(user_id, conversation_id)
    if not conversation:
        raise ServiceError("not_found", 404)
    return conversation


def create_conversation(user_id: UUID, project_id: UUID, payload: dict) -> Conversation:
    project = owned_project(user_id, project_id)
    if not project:
        raise ServiceError("not_found", 404)
    conversation = Conversation(
        project=project, title=str(payload.get("title") or "New conversation")[:200]
    )
    db.session.add(conversation)
    db.session.commit()
    return conversation


def delete_conversation(user_id: UUID, conversation_id: UUID) -> None:
    conversation = get_conversation(user_id, conversation_id)
    db.session.delete(conversation)
    db.session.commit()


def add_message(user_id: UUID, conversation_id: UUID, payload: dict) -> Message:
    conversation = get_conversation(user_id, conversation_id)
    role = str(payload.get("role") or "")
    content = str(payload.get("content") or "").strip()
    if role not in {"user", "assistant"} or not content:
        raise ServiceError("validation_error", 422)
    if role == "user" and not conversation.messages:
        conversation.title = content.replace("\n", " ")[:60]
    message = Message(conversation=conversation, role=role, content=content)
    db.session.add(message)
    db.session.commit()
    return message


def edit_last_user_message(
    user_id: UUID, conversation_id: UUID, message_id: UUID, content: str
) -> Conversation:
    conversation = get_conversation(user_id, conversation_id)
    content = content.strip()
    messages = list(conversation.messages)
    target = next((message for message in messages if message.id == message_id), None)
    last_user = next((message for message in reversed(messages) if message.role == "user"), None)
    if not target or target is not last_user or not content:
        raise ServiceError("validation_error", 422)
    target.content = content
    for message in messages[messages.index(target) + 1 :]:
        db.session.delete(message)
    if target is next((message for message in messages if message.role == "user"), None):
        conversation.title = content.replace("\n", " ")[:60]
    db.session.commit()
    return conversation


def prepare_user_prompt(
    user_id: UUID, conversation_id: UUID, content: str, edit_message_id: str | None
) -> Conversation:
    conversation = get_conversation(user_id, conversation_id)
    content = content.strip()
    if not content:
        raise ServiceError("validation_error", 422)
    messages = list(conversation.messages)
    if edit_message_id:
        try:
            message_id = UUID(str(edit_message_id))
        except ValueError as error:
            raise ServiceError("validation_error", 422) from error
        return edit_last_user_message(user_id, conversation_id, message_id, content)
    db.session.add(Message(conversation=conversation, role="user", content=content))
    if not any(message.role == "user" for message in messages):
        conversation.title = content.replace("\n", " ")[:60]
    db.session.commit()
    return conversation
