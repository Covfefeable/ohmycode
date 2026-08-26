from uuid import UUID

from celery import shared_task
from flask import current_app
from redis import Redis
from redis.exceptions import LockError

from ..services.capabilities.retrieval import sync_capability_index
from ..services.retrieval.embedding_jobs import (
    all_user_ids,
    chunks,
    enqueue_embedding_documents,
    pending_embedding_document_ids,
    process_embedding_documents,
)


@shared_task(
    bind=True,
    name="app.tasks.capability_embedding.embed_capability_documents",
    max_retries=5,
)
def embed_capability_documents(self, document_ids: list[str]):
    try:
        return process_embedding_documents([UUID(value) for value in document_ids])
    except Exception as error:
        raise self.retry(exc=error, countdown=min(300, 2 ** (self.request.retries + 1) * 5))


@shared_task(name="app.tasks.capability_embedding.reconcile_capability_embeddings")
def reconcile_capability_embeddings():
    redis = Redis.from_url(current_app.config["CELERY_BROKER_URL"])
    lock = redis.lock("ohmycode:capability-embedding:reconcile", timeout=240, blocking_timeout=0)
    if not lock.acquire(blocking=False):
        return 0
    try:
        for user_id in all_user_ids():
            sync_capability_index(user_id, enqueue=False)
        document_ids = pending_embedding_document_ids()
        for batch in chunks(document_ids):
            enqueue_embedding_documents(batch)
        return len(document_ids)
    finally:
        try:
            lock.release()
        except LockError:
            current_app.logger.warning("Capability embedding reconcile lock expired")
