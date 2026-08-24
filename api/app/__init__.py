from flask import Flask

from .config import config_by_name
from .extensions import cors, db, jwt, migrate
from .routes import register_routes
from .services.errors import ServiceError


def create_app(config_name: str | None = None) -> Flask:
    app = Flask(__name__)
    selected = config_name or app.config.get("APP_ENV") or "development"
    app.config.from_object(config_by_name.get(selected, config_by_name["development"]))

    db.init_app(app)
    migrate.init_app(app, db)
    jwt.init_app(app)
    cors.init_app(app, resources={r"/api/*": {"origins": app.config["CORS_ORIGINS"]}})

    from . import models  # noqa: F401

    register_routes(app)
    register_jwt_handlers(app)
    register_service_error_handler(app)
    return app


def register_service_error_handler(app: Flask) -> None:
    @app.errorhandler(ServiceError)
    def service_error(error: ServiceError):
        return {"error": {"code": error.code}}, error.status


def register_jwt_handlers(app: Flask) -> None:
    @jwt.unauthorized_loader
    def unauthorized(reason: str):
        return {"error": {"code": "authorization_required", "message": reason}}, 401

    @jwt.invalid_token_loader
    def invalid_token(reason: str):
        return {"error": {"code": "invalid_token", "message": reason}}, 401

    @jwt.expired_token_loader
    def expired_token(_header: dict, _payload: dict):
        return {"error": {"code": "token_expired", "message": "Token has expired"}}, 401
