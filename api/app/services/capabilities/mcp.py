import json
import re
from uuid import UUID

from ...extensions import db
from ...models import McpServer
from ..errors import ServiceError
from ..model_credentials import cipher
from .retrieval import sync_capability_index

IDENTIFIER_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")


def _encrypt(configuration: dict) -> bytes:
    return cipher().encrypt(json.dumps(configuration, ensure_ascii=False).encode())


def _decrypt(server: McpServer) -> dict:
    return json.loads(cipher().decrypt(server.configuration_encrypted).decode())


def _public(server: McpServer) -> dict:
    configuration = _decrypt(server)
    if server.transport == "http":
        public_configuration = {
            "url": configuration.get("url", ""),
            "headers": [
                {"key": key, "hasValue": bool(value)}
                for key, value in configuration.get("headers", {}).items()
            ],
        }
    else:
        public_configuration = {
            "command": configuration.get("command", ""),
            "args": configuration.get("args", []),
            "cwd": configuration.get("cwd", ""),
            "env": [
                {"key": key, "hasValue": bool(value)}
                for key, value in configuration.get("env", {}).items()
            ],
        }
    return {
        "id": str(server.id),
        "name": server.name,
        "identifier": server.identifier,
        "transport": server.transport,
        "configuration": public_configuration,
        "enabled": server.enabled,
        "tools": server.tools or [],
        "status": server.status,
        "lastError": server.last_error,
    }


def list_mcp_servers(user_id: UUID) -> list[dict]:
    servers = db.session.scalars(
        db.select(McpServer).where(McpServer.user_id == user_id).order_by(McpServer.created_at)
    )
    return [_public(server) for server in servers]


def runtime_mcp_servers(user_id: UUID) -> list[dict]:
    servers = db.session.scalars(
        db.select(McpServer).where(McpServer.user_id == user_id, McpServer.enabled.is_(True))
    )
    return [
        {
            "id": str(server.id),
            "name": server.name,
            "identifier": server.identifier,
            "transport": server.transport,
            "configuration": _decrypt(server),
            "tools": server.tools or [],
        }
        for server in servers
    ]


def save_mcp_server(user_id: UUID, payload: dict, server_id: UUID | None = None) -> dict:
    server = db.session.get(McpServer, server_id) if server_id else None
    if server and server.user_id != user_id:
        raise ServiceError("not_found", 404)
    name = str(payload.get("name") or "").strip()[:100]
    identifier = str(payload.get("identifier") or "").strip().lower()[:64]
    transport = str(payload.get("transport") or "")
    configuration = (
        payload.get("configuration") if isinstance(payload.get("configuration"), dict) else {}
    )
    if (
        not name
        or not IDENTIFIER_PATTERN.fullmatch(identifier)
        or transport not in {"http", "stdio"}
    ):
        raise ServiceError("validation_error", 422)
    previous = _decrypt(server) if server else {}
    if transport == "http":
        url = str(configuration.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            raise ServiceError("validation_error", 422)
        headers = configuration.get("headers")
        normalized = {
            "url": url,
            "headers": headers if isinstance(headers, dict) else previous.get("headers", {}),
        }
    else:
        command = str(configuration.get("command") or "").strip()
        if not command:
            raise ServiceError("validation_error", 422)
        normalized = {
            "command": command,
            "args": [str(item) for item in configuration.get("args") or []],
            "cwd": str(configuration.get("cwd") or ""),
            "env": (
                configuration["env"]
                if isinstance(configuration.get("env"), dict)
                else previous.get("env", {})
            ),
        }
    duplicate_query = db.select(McpServer).where(
        McpServer.user_id == user_id,
        McpServer.identifier == identifier,
    )
    if server:
        duplicate_query = duplicate_query.where(McpServer.id != server.id)
    duplicate = db.session.scalar(duplicate_query)
    if duplicate:
        raise ServiceError("mcp_identifier_exists", 409)
    if not server:
        server = McpServer(user_id=user_id, tools=[])
    server.name = name
    server.identifier = identifier
    server.transport = transport
    server.configuration_encrypted = _encrypt(normalized)
    server.enabled = bool(payload.get("enabled", True))
    server.status = "unverified"
    server.last_error = None
    db.session.add(server)
    db.session.commit()
    sync_capability_index(user_id)
    return _public(server)


def update_mcp_tools(
    user_id: UUID, server_id: UUID, tools: list[dict], error: str | None = None
) -> dict:
    server = db.session.get(McpServer, server_id)
    if not server or server.user_id != user_id:
        raise ServiceError("not_found", 404)
    server.tools = tools[:500]
    server.status = "failed" if error else "connected"
    server.last_error = error[:1000] if error else None
    db.session.commit()
    sync_capability_index(user_id)
    return _public(server)


def delete_mcp_server(user_id: UUID, server_id: UUID) -> None:
    server = db.session.get(McpServer, server_id)
    if not server or server.user_id != user_id:
        raise ServiceError("not_found", 404)
    db.session.delete(server)
    db.session.commit()
    sync_capability_index(user_id)
