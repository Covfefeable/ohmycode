from flask_jwt_extended import create_access_token, create_refresh_token

from ...models import User


def create_token_pair(user: User) -> dict[str, str]:
    identity = str(user.id)
    return {
        "accessToken": create_access_token(identity=identity),
        "refreshToken": create_refresh_token(identity=identity),
    }
