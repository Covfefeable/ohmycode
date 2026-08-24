import re
from dataclasses import dataclass

EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class ValidationError(ValueError):
    def __init__(self, fields: dict[str, str]):
        super().__init__("Invalid authentication payload")
        self.fields = fields


@dataclass(frozen=True)
class RegistrationData:
    email: str
    display_name: str
    password: str

    @classmethod
    def from_payload(cls, payload: dict) -> "RegistrationData":
        email = str(payload.get("email") or "").strip().lower()
        display_name = str(payload.get("displayName") or "").strip()
        password = str(payload.get("password") or "")
        fields: dict[str, str] = {}
        if not EMAIL_PATTERN.match(email):
            fields["email"] = "invalid_email"
        if len(display_name) < 2 or len(display_name) > 100:
            fields["displayName"] = "invalid_display_name"
        if len(password) < 8 or len(password) > 128:
            fields["password"] = "invalid_password_length"
        if fields:
            raise ValidationError(fields)
        return cls(email=email, display_name=display_name, password=password)


@dataclass(frozen=True)
class LoginData:
    email: str
    password: str

    @classmethod
    def from_payload(cls, payload: dict) -> "LoginData":
        email = str(payload.get("email") or "").strip().lower()
        password = str(payload.get("password") or "")
        fields: dict[str, str] = {}
        if not EMAIL_PATTERN.match(email):
            fields["email"] = "invalid_email"
        if not password:
            fields["password"] = "password_required"
        if fields:
            raise ValidationError(fields)
        return cls(email=email, password=password)
