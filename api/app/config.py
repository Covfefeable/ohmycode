import os
from datetime import timedelta


class BaseConfig:
    SECRET_KEY = os.getenv("SECRET_KEY", "development-only-secret")
    JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", SECRET_KEY)
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(minutes=30)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)
    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL", "postgresql+psycopg://ohmycode:ohmycode@localhost:5432/ohmycode"
    )
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
    MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "ohmycode")
    MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "ohmycode-development-secret")
    MINIO_BUCKET = os.getenv("MINIO_BUCKET", "ohmycode")
    MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() in {"1", "true", "yes"}
    CORS_ORIGINS = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"
        ).split(",")
        if origin.strip()
    ]


class DevelopmentConfig(BaseConfig):
    DEBUG = True


class TestingConfig(BaseConfig):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = "sqlite:///:memory:"
    REDIS_URL = "redis://localhost:6379/15"
    JWT_SECRET_KEY = "testing-jwt-secret-with-at-least-32-bytes"


class ProductionConfig(BaseConfig):
    DEBUG = False

    @classmethod
    def validate(cls) -> None:
        invalid_values = {
            "development-only-secret",
            "replace-with-a-long-random-secret",
            "replace-with-an-independent-long-random-secret",
        }
        for name in ("SECRET_KEY", "JWT_SECRET_KEY"):
            value = str(getattr(cls, name, ""))
            if len(value) < 32 or value in invalid_values:
                raise RuntimeError(
                    f"{name} must be an independent random value of at least 32 characters"
                )
        if cls.SECRET_KEY == cls.JWT_SECRET_KEY:
            raise RuntimeError("SECRET_KEY and JWT_SECRET_KEY must be different")


config_by_name = {
    "development": DevelopmentConfig,
    "testing": TestingConfig,
    "production": ProductionConfig,
}
