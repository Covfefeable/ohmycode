from sqlalchemy.exc import IntegrityError

from ...extensions import db
from ...models import User
from .schemas import LoginData, RegistrationData


class EmailAlreadyRegisteredError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


def register_user(data: RegistrationData) -> User:
    user = User(email=data.email, display_name=data.display_name)
    user.set_password(data.password)
    db.session.add(user)
    try:
        db.session.commit()
    except IntegrityError as error:
        db.session.rollback()
        raise EmailAlreadyRegisteredError from error
    return user


def authenticate_user(data: LoginData) -> User:
    user = db.session.execute(db.select(User).where(User.email == data.email)).scalar_one_or_none()
    if user is None or not user.is_active or not user.check_password(data.password):
        raise InvalidCredentialsError
    return user

