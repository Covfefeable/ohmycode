from flask import Blueprint, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from ..services.auth.commands import (
    EmailAlreadyRegisteredError,
    InvalidCredentialsError,
    authenticate_user,
    register_user,
)
from ..services.auth.queries import get_user, serialize_user
from ..services.auth.schemas import LoginData, RegistrationData, ValidationError
from ..services.auth.tokens import create_token_pair

auth_bp = Blueprint("auth", __name__)


def error_response(code: str, status: int, fields: dict[str, str] | None = None):
    error: dict[str, object] = {"code": code}
    if fields:
        error["fields"] = fields
    return jsonify({"error": error}), status


@auth_bp.post("/register")
def register():
    try:
        data = RegistrationData.from_payload(request.get_json(silent=True) or {})
        user = register_user(data)
    except ValidationError as error:
        return error_response("validation_error", 422, error.fields)
    except EmailAlreadyRegisteredError:
        return error_response("email_already_registered", 409)
    return jsonify({"user": serialize_user(user), "tokens": create_token_pair(user)}), 201


@auth_bp.post("/login")
def login():
    try:
        data = LoginData.from_payload(request.get_json(silent=True) or {})
        user = authenticate_user(data)
    except ValidationError as error:
        return error_response("validation_error", 422, error.fields)
    except InvalidCredentialsError:
        return error_response("invalid_credentials", 401)
    return jsonify({"user": serialize_user(user), "tokens": create_token_pair(user)})


@auth_bp.get("/me")
@jwt_required()
def me():
    user = get_user(get_jwt_identity())
    if user is None or not user.is_active:
        return error_response("user_not_found", 404)
    return jsonify({"user": serialize_user(user)})


@auth_bp.post("/refresh")
@jwt_required(refresh=True)
def refresh():
    user = get_user(get_jwt_identity())
    if user is None or not user.is_active:
        return error_response("user_not_found", 404)
    return jsonify({"tokens": create_token_pair(user)})

