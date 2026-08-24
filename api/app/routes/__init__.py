from flask import Flask

from .auth import auth_bp
from .health import health_bp
from .projects import projects_bp
from .sessions import sessions_bp
from .settings import settings_bp


def register_routes(app: Flask) -> None:
    app.register_blueprint(auth_bp, url_prefix="/api/auth")
    app.register_blueprint(health_bp, url_prefix="/api")
    app.register_blueprint(projects_bp, url_prefix="/api/projects")
    app.register_blueprint(sessions_bp, url_prefix="/api/sessions")
    app.register_blueprint(settings_bp, url_prefix="/api/settings")
