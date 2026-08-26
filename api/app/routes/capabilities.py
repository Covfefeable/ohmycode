from uuid import UUID

from flask import Blueprint, Response, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.capabilities import (
    delete_mcp_server,
    delete_skill,
    download_skill,
    list_mcp_servers,
    list_skills,
    runtime_mcp_servers,
    save_mcp_server,
    save_skill,
    search_capabilities,
    update_mcp_tools,
)

capabilities_bp = Blueprint("capabilities", __name__)


def user_id() -> UUID:
    return UUID(get_jwt_identity())


@capabilities_bp.post("/search")
@jwt_required()
def search_capabilities_route():
    payload = request.get_json(silent=True) or {}
    return jsonify({"results": search_capabilities(user_id(), str(payload.get("query") or ""))})


@capabilities_bp.get("/mcp")
@jwt_required()
def list_mcp_route():
    return jsonify({"servers": list_mcp_servers(user_id())})


@capabilities_bp.get("/mcp/runtime")
@jwt_required()
def runtime_mcp_route():
    return jsonify({"servers": runtime_mcp_servers(user_id())})


@capabilities_bp.post("/mcp")
@jwt_required()
def create_mcp_route():
    return jsonify(save_mcp_server(user_id(), request.get_json(silent=True) or {})), 201


@capabilities_bp.put("/mcp/<uuid:server_id>")
@jwt_required()
def update_mcp_route(server_id: UUID):
    return jsonify(save_mcp_server(user_id(), request.get_json(silent=True) or {}, server_id))


@capabilities_bp.put("/mcp/<uuid:server_id>/tools")
@jwt_required()
def update_mcp_tools_route(server_id: UUID):
    payload = request.get_json(silent=True) or {}
    tools = payload.get("tools") if isinstance(payload.get("tools"), list) else []
    return jsonify(update_mcp_tools(user_id(), server_id, tools, payload.get("error")))


@capabilities_bp.delete("/mcp/<uuid:server_id>")
@jwt_required()
def delete_mcp_route(server_id: UUID):
    delete_mcp_server(user_id(), server_id)
    return "", 204


@capabilities_bp.get("/skills")
@jwt_required()
def list_skills_route():
    return jsonify({"skills": list_skills(user_id())})


@capabilities_bp.post("/skills")
@jwt_required()
def create_skill_route():
    return jsonify(save_skill(user_id(), request.get_json(silent=True) or {})), 201


@capabilities_bp.get("/skills/<uuid:skill_id>/archive")
@jwt_required()
def download_skill_route(skill_id: UUID):
    content, digest = download_skill(user_id(), skill_id)
    return Response(
        content,
        mimetype="application/zip",
        headers={
            "X-Content-SHA256": digest,
            "Content-Disposition": f'attachment; filename="{skill_id}.zip"',
        },
    )


@capabilities_bp.delete("/skills/<uuid:skill_id>")
@jwt_required()
def delete_skill_route(skill_id: UUID):
    delete_skill(user_id(), skill_id)
    return "", 204
