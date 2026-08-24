from flask import current_app
from redis import Redis


def get_redis() -> Redis:
    return Redis.from_url(current_app.config["REDIS_URL"], decode_responses=True)

