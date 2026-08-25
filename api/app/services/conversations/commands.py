from uuid import UUID

from ...extensions import db
from ...models import Conversation, Message
from ..errors import ServiceError
from ..projects.queries import owned_conversation, owned_project


def normalize_attachments(value: object) -> list[dict]:
    if not isinstance(value, list) or len(value) > 20:
        raise ServiceError("invalid_attachments", 422)
    attachments: list[dict] = []
    for item in value:
        if not isinstance(item, dict):
            raise ServiceError("invalid_attachments", 422)
        attachment_id = str(item.get("id") or "").strip()[:100]
        name = str(item.get("name") or "").strip()[:255]
        path = str(item.get("path") or "").strip()[:4096]
        mime_type = str(item.get("mimeType") or "").strip()[:255]
        try:
            size = int(item.get("size") or 0)
        except (TypeError, ValueError) as error:
            raise ServiceError("invalid_attachments", 422) from error
        if not attachment_id or not name or not path or size < 0:
            raise ServiceError("invalid_attachments", 422)
        attachments.append(
            {"id": attachment_id, "name": name, "path": path, "mimeType": mime_type, "size": size}
        )
    return attachments


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
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    edit_message_id: str | None,
    attachments: object = None,
) -> Conversation:
    conversation = get_conversation(user_id, conversation_id)
    content = content.strip()
    messages = list(conversation.messages)
    if edit_message_id:
        try:
            message_id = UUID(str(edit_message_id))
        except ValueError as error:
            raise ServiceError("validation_error", 422) from error
        return edit_last_user_message(user_id, conversation_id, message_id, content)
    normalized_attachments = normalize_attachments(attachments or [])
    if not content and not normalized_attachments:
        raise ServiceError("validation_error", 422)
    db.session.add(
        Message(
            conversation=conversation,
            role="user",
            content=content,
            attachments=normalized_attachments or None,
        )
    )
    if not any(message.role == "user" for message in messages):
        conversation.title = (content.replace("\n", " ") or normalized_attachments[0]["name"])[:60]
    db.session.commit()
    return conversation
