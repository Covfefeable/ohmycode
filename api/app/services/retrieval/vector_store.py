from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from ...extensions import db
from ...models import RetrievalDocument


@dataclass(frozen=True)
class VectorHit:
    document_id: UUID
    score: float


class VectorStore(Protocol):
    def search(
        self,
        user_id: UUID,
        vector: list[float],
        model: str,
        version: str,
        limit: int,
    ) -> list[VectorHit]: ...


class PgVectorStore:
    def search(
        self,
        user_id: UUID,
        vector: list[float],
        model: str,
        version: str,
        limit: int,
    ) -> list[VectorHit]:
        distance = RetrievalDocument.embedding.cosine_distance(vector)
        rows = db.session.execute(
            db.select(RetrievalDocument.id, distance.label("distance"))
            .where(
                RetrievalDocument.user_id == user_id,
                RetrievalDocument.embedding.is_not(None),
                RetrievalDocument.embedding_model == model,
                RetrievalDocument.embedding_version == version,
            )
            .order_by(distance)
            .limit(limit)
        )
        return [
            VectorHit(document_id=document_id, score=max(0.0, min(1.0, 1.0 - float(distance))))
            for document_id, distance in rows
        ]
