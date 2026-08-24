import base64
import hashlib

from cryptography.fernet import Fernet
from flask import current_app


def cipher() -> Fernet:
    secret = current_app.config["SECRET_KEY"].encode()
    return Fernet(base64.urlsafe_b64encode(hashlib.sha256(secret).digest()))


def encrypt_api_key(api_key: str) -> bytes:
    return cipher().encrypt(api_key.encode())


def decrypt_api_key(value: bytes) -> str:
    return cipher().decrypt(value).decode()
