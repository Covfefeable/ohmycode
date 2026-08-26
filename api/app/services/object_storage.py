from io import BytesIO

from flask import current_app
from minio import Minio
from minio.error import S3Error

from .errors import ServiceError


def _client() -> Minio:
    return Minio(
        current_app.config["MINIO_ENDPOINT"],
        access_key=current_app.config["MINIO_ACCESS_KEY"],
        secret_key=current_app.config["MINIO_SECRET_KEY"],
        secure=bool(current_app.config["MINIO_SECURE"]),
    )


def _bucket(client: Minio) -> str:
    bucket = current_app.config["MINIO_BUCKET"]
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
    except Exception as error:
        raise ServiceError("object_storage_unavailable", 503) from error
    return bucket


def put_object(key: str, content: bytes, content_type: str) -> None:
    client = _client()
    try:
        client.put_object(
            _bucket(client), key, BytesIO(content), len(content), content_type=content_type
        )
    except Exception as error:
        raise ServiceError("object_storage_unavailable", 503) from error


def get_object(key: str) -> tuple[bytes, str]:
    client = _client()
    response = None
    try:
        response = client.get_object(_bucket(client), key)
        return response.read(), str(
            response.headers.get("content-type") or "application/octet-stream"
        )
    except S3Error as error:
        if error.code in {"NoSuchKey", "NoSuchObject", "NoSuchBucket"}:
            raise ServiceError("object_not_found", 404) from error
        raise ServiceError("object_storage_unavailable", 503) from error
    except Exception as error:
        raise ServiceError("object_storage_unavailable", 503) from error
    finally:
        if response is not None:
            response.close()
            response.release_conn()


def delete_object(key: str) -> None:
    client = _client()
    try:
        client.remove_object(_bucket(client), key)
    except Exception as error:
        raise ServiceError("object_storage_unavailable", 503) from error
