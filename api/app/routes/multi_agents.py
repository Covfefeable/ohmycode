from uuid import UUID

from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.errors import ServiceError
from ..services.multi_agents import (
    complete_node,
    create_agent,
    create_task,
    delete_agent,
    delete_task,
    fail_node,
    get_task,
    list_agents,
    post_message,
    record_changes,
    replace_flow,
    serialize_agent,
    serialize_task,
    start_node,
    start_task,
    stop_task,
    update_agent,
    wake_node,
)

multi_agents_bp = Blueprint("multi_agents", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


@multi_agents_bp.get("")
@jwt_required()
def list_agents_route():
    return jsonify([serialize_agent(agent) for agent in list_agents(user_id())])


@multi_agents_bp.post("")
@jwt_required()
def create_agent_route():
    return jsonify(
        serialize_agent(create_agent(user_id(), request.get_json(silent=True) or {}))
    ), 201


@multi_agents_bp.patch("/<uuid:agent_id>")
@jwt_required()
def update_agent_route(agent_id: UUID):
    return jsonify(
        serialize_agent(update_agent(user_id(), agent_id, request.get_json(silent=True) or {}))
    )


@multi_agents_bp.delete("/<uuid:agent_id>")
@jwt_required()
def delete_agent_route(agent_id: UUID):
    delete_agent(user_id(), agent_id)
    return "", 204


@multi_agents_bp.post("/<uuid:agent_id>/tasks")
@jwt_required()
def create_task_route(agent_id: UUID):
    task = create_task(user_id(), agent_id, request.get_json(silent=True) or {})
    return jsonify(serialize_task(task)), 201


@multi_agents_bp.get("/tasks/<uuid:task_id>")
@jwt_required()
def get_task_route(task_id: UUID):
    task = get_task(user_id(), task_id)
    if not task:
        raise ServiceError("not_found", 404)
    return jsonify(serialize_task(task))


@multi_agents_bp.patch("/tasks/<uuid:task_id>/flow")
@jwt_required()
def replace_flow_route(task_id: UUID):
    return jsonify(
        serialize_task(replace_flow(user_id(), task_id, request.get_json(silent=True) or {}))
    )


@multi_agents_bp.delete("/tasks/<uuid:task_id>")
@jwt_required()
def delete_task_route(task_id: UUID):
    delete_task(user_id(), task_id)
    return "", 204


@multi_agents_bp.post("/nodes/<uuid:node_id>/messages")
@jwt_required()
def post_message_route(node_id: UUID):
    message = post_message(user_id(), node_id, request.get_json(silent=True) or {})
    return jsonify(
        {
            "id": str(message.id),
            "targetStatus": message.to_node.status,
            "targetOutput": message.to_node.final_output,
        }
    ), 201


@multi_agents_bp.post("/nodes/<uuid:node_id>/changes")
@jwt_required()
def record_changes_route(node_id: UUID):
    task = record_changes(user_id(), node_id, request.get_json(silent=True) or {})
    return jsonify(serialize_task(task)), 201


@multi_agents_bp.post("/tasks/<uuid:task_id>/start")
@jwt_required()
def start_task_route(task_id: UUID):
    return jsonify(serialize_task(start_task(user_id(), task_id)))


@multi_agents_bp.post("/tasks/<uuid:task_id>/stop")
@jwt_required()
def stop_task_route(task_id: UUID):
    return jsonify(serialize_task(stop_task(user_id(), task_id)))


@multi_agents_bp.post("/nodes/<uuid:node_id>/start")
@jwt_required()
def start_node_route(node_id: UUID):
    node, prompt = start_node(user_id(), node_id)
    return jsonify(
        {
            "nodeId": str(node.id),
            "conversationId": str(node.conversation_id),
            "modelId": str(node.model_configuration_id) if node.model_configuration_id else None,
            "prompt": prompt,
        }
    )


@multi_agents_bp.post("/nodes/<uuid:node_id>/wake")
@jwt_required()
def wake_node_route(node_id: UUID):
    node = wake_node(user_id(), node_id)
    return jsonify({
        "nodeId": str(node.id),
        "conversationId": str(node.conversation_id),
        "modelId": str(node.model_configuration_id) if node.model_configuration_id else None,
    })


@multi_agents_bp.post("/nodes/<uuid:node_id>/complete")
@jwt_required()
def complete_node_route(node_id: UUID):
    task = complete_node(user_id(), node_id, request.get_json(silent=True) or {})
    return jsonify(serialize_task(task))


@multi_agents_bp.post("/nodes/<uuid:node_id>/fail")
@jwt_required()
def fail_node_route(node_id: UUID):
    payload = request.get_json(silent=True) or {}
    task = fail_node(user_id(), node_id, str(payload.get("errorCode") or "node_failed"))
    return jsonify(serialize_task(task))
