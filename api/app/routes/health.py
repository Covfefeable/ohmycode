from flask import Blueprint, jsonify

from ..services.system.health import dependency_status

health_bp = Blueprint("health", __name__)


@health_bp.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "ohmycode-api",
            "version": "0.1.0",
            "capabilities": [
                "auth",
                "projects",
                "settings",
                "agent-runs",
                "token-usage",
                "multi-agent",
                "mcp",
                "skills",
                "capability-retrieval",
                "mobile-chat",
            ],
        }
    )


@health_bp.get("/health/ready")
def readiness():
    dependencies, healthy = dependency_status()
    return jsonify({"status": "ok" if healthy else "degraded", "dependencies": dependencies}), (
        200 if healthy else 503
    )
