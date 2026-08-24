import json
from uuid import UUID

import httpx
from flask import Blueprint, Response, jsonify, request, stream_with_context
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..extensions import db
from ..models import Conversation, Message, ModelConfiguration, Project
from ..services.model_credentials import decrypt_api_key

projects_bp = Blueprint("projects", __name__)


def current_user_id() -> UUID:
    return UUID(get_jwt_identity())


def serialize_message(message: Message) -> dict:
    return {
        "id": str(message.id),
        "role": message.role,
        "content": message.content,
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


def owned_project(project_id: UUID) -> Project | None:
    return db.session.scalar(
        db.select(Project).where(Project.id == project_id, Project.user_id == current_user_id())
    )


def owned_conversation(conversation_id: UUID) -> Conversation | None:
    return db.session.scalar(
        db.select(Conversation)
        .join(Project)
        .where(Conversation.id == conversation_id, Project.user_id == current_user_id())
    )


@projects_bp.get("")
@jwt_required()
def list_projects():
    projects = db.session.scalars(
        db.select(Project).where(Project.user_id == current_user_id()).order_by(Project.created_at)
    )
    return jsonify([serialize_project(project) for project in projects])


@projects_bp.post("")
@jwt_required()
def create_project():
    payload = request.get_json(silent=True) or {}
    project_path = str(payload.get("path") or "").strip()[:1024]
    name = str(payload.get("name") or "").strip()[:255]
    if not project_path or not name:
        return jsonify({"error": {"code": "validation_error"}}), 422
    existing = db.session.scalar(
        db.select(Project).where(Project.user_id == current_user_id(), Project.path == project_path)
    )
    if existing:
        return jsonify({"error": {"code": "project_exists"}}), 409
    project = Project(user_id=current_user_id(), name=name, path=project_path)
    db.session.add(project)
    db.session.commit()
    return jsonify(serialize_project(project)), 201


@projects_bp.delete("/<uuid:project_id>")
@jwt_required()
def delete_project(project_id: UUID):
    project = owned_project(project_id)
    if not project:
        return jsonify({"error": {"code": "not_found"}}), 404
    db.session.delete(project)
    db.session.commit()
    return "", 204


@projects_bp.post("/<uuid:project_id>/conversations")
@jwt_required()
def create_conversation(project_id: UUID):
    project = owned_project(project_id)
    if not project:
        return jsonify({"error": {"code": "not_found"}}), 404
    payload = request.get_json(silent=True) or {}
    conversation = Conversation(
        project=project, title=str(payload.get("title") or "New conversation")[:200]
    )
    db.session.add(conversation)
    db.session.commit()
    return jsonify(serialize_conversation(conversation)), 201


@projects_bp.get("/conversations/<uuid:conversation_id>")
@jwt_required()
def get_conversation(conversation_id: UUID):
    conversation = owned_conversation(conversation_id)
    if not conversation:
        return jsonify({"error": {"code": "not_found"}}), 404
    return jsonify(serialize_conversation(conversation, include_messages=True))


@projects_bp.delete("/conversations/<uuid:conversation_id>")
@jwt_required()
def delete_conversation(conversation_id: UUID):
    conversation = owned_conversation(conversation_id)
    if not conversation:
        return jsonify({"error": {"code": "not_found"}}), 404
    db.session.delete(conversation)
    db.session.commit()
    return "", 204


@projects_bp.post("/conversations/<uuid:conversation_id>/messages")
@jwt_required()
def add_message(conversation_id: UUID):
    conversation = owned_conversation(conversation_id)
    if not conversation:
        return jsonify({"error": {"code": "not_found"}}), 404
    payload = request.get_json(silent=True) or {}
    role = str(payload.get("role") or "")
    content = str(payload.get("content") or "").strip()
    if role not in {"user", "assistant"} or not content:
        return jsonify({"error": {"code": "validation_error"}}), 422
    if role == "user" and not conversation.messages:
        conversation.title = content.replace("\n", " ")[:60]
    message = Message(conversation=conversation, role=role, content=content)
    db.session.add(message)
    db.session.commit()
    return jsonify(serialize_message(message)), 201


@projects_bp.post("/conversations/<uuid:conversation_id>/stream")
@jwt_required()
def stream_completion(conversation_id: UUID):
    conversation = owned_conversation(conversation_id)
    if not conversation:
        return jsonify({"error": {"code": "not_found"}}), 404
    payload = request.get_json(silent=True) or {}
    content = str(payload.get("content") or "").strip()
    if not content:
        return jsonify({"error": {"code": "validation_error"}}), 422

    messages_before = list(conversation.messages)
    edit_message_id = payload.get("editMessageId")
    if edit_message_id:
        messages = list(conversation.messages)
        target = next((item for item in messages if str(item.id) == str(edit_message_id)), None)
        last_user = next((item for item in reversed(messages) if item.role == "user"), None)
        if not target or target is not last_user:
            return jsonify({"error": {"code": "validation_error"}}), 422
        target.content = content
        if target is next((item for item in messages if item.role == "user"), None):
            conversation.title = content.replace("\n", " ")[:60]
        for old_message in messages[messages.index(target) + 1 :]:
            db.session.delete(old_message)
    else:
        db.session.add(Message(conversation=conversation, role="user", content=content))
        if not any(item.role == "user" for item in messages_before):
            conversation.title = content.replace("\n", " ")[:60]
    db.session.commit()

    model_query = db.select(ModelConfiguration).where(
        ModelConfiguration.user_id == current_user_id()
    )
    if payload.get("modelId"):
        model_query = model_query.where(ModelConfiguration.id == UUID(str(payload["modelId"])))
    else:
        model_query = model_query.order_by(ModelConfiguration.position)
    configuration = db.session.scalar(model_query)
    if not configuration:
        return jsonify({"error": {"code": "model_not_configured"}}), 422
    history = [{"role": item.role, "content": item.content} for item in conversation.messages]
    provider_payload = {
        "model": configuration.model,
        "stream": True,
        "messages": [
            {"role": "system", "content": "You are OhMyCode, a concise and capable coding agent."},
            *history,
        ],
    }
    api_key = decrypt_api_key(configuration.api_key_encrypted)

    @stream_with_context
    def generate():
        answer = ""
        with httpx.stream(
            "POST",
            f"{configuration.base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json=provider_payload,
            timeout=120,
        ) as provider_response:
            provider_response.raise_for_status()
            for line in provider_response.iter_lines():
                data = line.removeprefix("data:").strip()
                if not data or data == "[DONE]":
                    continue
                parsed = json.loads(data)
                choice = (parsed.get("choices") or [{}])[0]
                delta = choice.get("delta") or {}
                chunk = delta.get("content") or delta.get("reasoning_content") or choice.get("text")
                if not chunk and choice.get("message"):
                    chunk = choice["message"].get("content")
                if chunk:
                    answer += chunk
                    yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"
        if answer:
            db.session.add(
                Message(conversation_id=conversation_id, role="assistant", content=answer)
            )
            db.session.commit()
        yield "data: [DONE]\n\n"

    return Response(
        generate(),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@projects_bp.patch("/conversations/<uuid:conversation_id>/messages/<uuid:message_id>")
@jwt_required()
def edit_last_user_message(conversation_id: UUID, message_id: UUID):
    conversation = owned_conversation(conversation_id)
    if not conversation:
        return jsonify({"error": {"code": "not_found"}}), 404
    content = str((request.get_json(silent=True) or {}).get("content") or "").strip()
    messages = list(conversation.messages)
    target = next((message for message in messages if message.id == message_id), None)
    last_user = next((message for message in reversed(messages) if message.role == "user"), None)
    if not target or target is not last_user or not content:
        return jsonify({"error": {"code": "validation_error"}}), 422
    target.content = content
    target_index = messages.index(target)
    for message in messages[target_index + 1 :]:
        db.session.delete(message)
    if target is next((message for message in messages if message.role == "user"), None):
        conversation.title = content.replace("\n", " ")[:60]
    db.session.commit()
    return jsonify(serialize_conversation(conversation, include_messages=True))
