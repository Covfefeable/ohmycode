from datetime import UTC, datetime, timedelta
from uuid import UUID

from flask import current_app
from sqlalchemy import and_, or_

from ...extensions import db
from ...models import RetrievalDocument, User
from .providers import embedding_provider

BATCH_SIZE = 20
MAX_ATTEMPTS = 6
LEASE_SECONDS = 300


def enqueue_embedding_documents(document_ids: list[UUID]) -> None:
    if not document_ids or current_app.config.get("TESTING") or embedding_provider() is None:
        return
    now = datetime.now(UTC)
    lease_until = now + timedelta(seconds=LEASE_SECONDS)
    documents = list(
        db.session.scalars(
            db.select(RetrievalDocument)
            .where(RetrievalDocument.id.in_(document_ids))
            .with_for_update(skip_locked=True)
        )
    )
    queued_ids: list[str] = []
    for document in documents:
        if document.embedding_status == "processing" and document.embedding_lease_until:
            if document.embedding_lease_until > now:
                continue
        document.embedding_status = "queued"
        document.embedding_lease_until = lease_until
        document.embedding_error = None
        queued_ids.append(str(document.id))
    db.session.commit()
    if not queued_ids:
        return
    try:
        current_app.extensions["celery"].send_task(
            "app.tasks.capability_embedding.embed_capability_documents",
            args=[queued_ids],
        )
    except Exception:
        db.session.execute(
            db.update(RetrievalDocument)
            .where(RetrievalDocument.id.in_([UUID(value) for value in queued_ids]))
            .values(embedding_status="pending", embedding_lease_until=None)
        )
        db.session.commit()
        current_app.logger.warning("Capability embedding enqueue failed", exc_info=True)


def process_embedding_documents(document_ids: list[UUID]) -> int:
    provider = embedding_provider()
    if provider is None or not document_ids:
        return 0
    now = datetime.now(UTC)
    documents = list(
        db.session.scalars(
            db.select(RetrievalDocument)
            .where(
                RetrievalDocument.id.in_(document_ids),
                RetrievalDocument.embedding_attempts < MAX_ATTEMPTS,
                or_(
                    RetrievalDocument.embedding_status.in_(("queued", "failed")),
                    and_(
                        RetrievalDocument.embedding_status == "processing",
                        RetrievalDocument.embedding_lease_until <= now,
                    ),
                ),
            )
            .with_for_update(skip_locked=True)
        )
    )
    if not documents:
        return 0
    lease_until = now + timedelta(seconds=LEASE_SECONDS)
    snapshots: dict[UUID, tuple[str, str]] = {}
    for document in documents:
        document.embedding_status = "processing"
        document.embedding_lease_until = lease_until
        document.embedding_attempts += 1
        snapshots[document.id] = (document.content_hash, document.content)
    db.session.commit()

    try:
        vectors = provider.embed([snapshots[document.id][1] for document in documents])
        refreshed = {
            document.id: document
            for document in db.session.scalars(
                db.select(RetrievalDocument).where(
                    RetrievalDocument.id.in_([item.id for item in documents])
                )
            )
        }
        completed = 0
        for source, vector in zip(documents, vectors, strict=True):
            document = refreshed.get(source.id)
            if document is None or document.content_hash != snapshots[source.id][0]:
                continue
            document.embedding = vector
            document.embedding_model = provider.model
            document.embedding_version = provider.version
            document.embedding_status = "ready"
            document.embedding_error = None
            document.embedding_lease_until = None
            document.embedding_updated_at = datetime.now(UTC)
            completed += 1
        db.session.commit()
        return completed
    except Exception as error:
        db.session.rollback()
        documents = list(
            db.session.scalars(
                db.select(RetrievalDocument).where(RetrievalDocument.id.in_(snapshots))
            )
        )
        for document in documents:
            if document.content_hash != snapshots[document.id][0]:
                continue
            document.embedding_status = "failed"
            document.embedding_error = str(error)[:2000]
            document.embedding_lease_until = None
        db.session.commit()
        raise


def pending_embedding_document_ids(limit: int = 200) -> list[UUID]:
    provider = embedding_provider()
    if provider is None:
        return []
    now = datetime.now(UTC)
    return list(
        db.session.scalars(
            db.select(RetrievalDocument.id)
            .where(
                RetrievalDocument.embedding_attempts < MAX_ATTEMPTS,
                or_(
                    RetrievalDocument.embedding.is_(None),
                    RetrievalDocument.embedding_model != provider.model,
                    RetrievalDocument.embedding_version != provider.version,
                ),
                or_(
                    RetrievalDocument.embedding_status.in_(("pending", "failed")),
                    RetrievalDocument.embedding_lease_until.is_(None),
                    RetrievalDocument.embedding_lease_until <= now,
                ),
            )
            .order_by(RetrievalDocument.updated_at)
            .limit(limit)
        )
    )


def all_user_ids() -> list[UUID]:
    return list(db.session.scalars(db.select(User.id)))


def chunks(values: list[UUID], size: int = BATCH_SIZE):
    for index in range(0, len(values), size):
        yield values[index : index + size]
