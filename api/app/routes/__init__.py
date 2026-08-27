from flask import Flask

from .agent_runs import agent_runs_bp
from .auth import auth_bp
from .capabilities import capabilities_bp
from .health import health_bp
from .mobile_chats import mobile_chats_bp
from .multi_agents import multi_agents_bp
from .projects import projects_bp
from .sessions import sessions_bp
from .settings import settings_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(agent_runs_bp, url_prefix="/api/agent-runs")
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(capabilities_bp, url_prefix="/api/capabilities")
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(mobile_chats_bp, url_prefix="/api/mobile/conversations")
    app.register_blueprint(multi_agents_bp, url_prefix="/api/multi-agents")
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(sessions_bp, url_prefix="/api/sessions")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
