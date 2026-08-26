import hashlib
import math
import re
from dataclasses import dataclass
from uuid import UUID

from flask import current_app

from ...extensions import db
from ...models import McpServer, RetrievalDocument, SkillPackage
from ..retrieval import (
    EmbeddingProvider,
    PgVectorStore,
    RerankProvider,
    VectorStore,
    embedding_provider,
    rerank_provider,
)

TOKEN_PATTERN = re.compile(r"[a-z0-9]+|[\u4e00-\u9fff]", re.IGNORECASE)
VECTOR_RECALL_LIMIT = 60
RERANK_LIMIT = 30
RESULT_LIMIT = 10


@dataclass(frozen=True)
class DesiredDocument:
    kind: str
    capability_id: UUID
    item_key: str
    capability_name: str
    capability_identifier: str | None
    item_name: str
    item_description: str
    content: str
    metadata: dict

    @property
    def key(self) -> tuple[str, UUID, str]:
        return self.kind, self.capability_id, self.item_key

    @property
    def content_hash(self) -> str:
        return hashlib.sha256(self.content.encode()).hexdigest()


def _desired_documents(user_id: UUID) -> list[DesiredDocument]:
    documents: list[DesiredDocument] = []
    servers = db.session.scalars(
        db.select(McpServer).where(McpServer.user_id == user_id, McpServer.enabled.is_(True))
    )
    for server in servers:
        for tool in server.tools or []:
            name = str(tool.get("name") or "").strip()
            if not name:
                continue
            description = str(tool.get("description") or "").strip()
            content = f"MCP server: {server.name}\nTool: {name}\nDescription: {description}"
            documents.append(
                DesiredDocument(
                    kind="mcp_tool",
                    capability_id=server.id,
                    item_key=name,
                    capability_name=server.name,
                    capability_identifier=server.identifier,
                    item_name=name,
                    item_description=description,
                    content=content,
                    metadata={"transport": server.transport},
                )
            )
    skills = db.session.scalars(
        db.select(SkillPackage).where(
            SkillPackage.user_id == user_id, SkillPackage.enabled.is_(True)
        )
    )
    for skill in skills:
        content = f"Skill: {skill.name}\nDescription: {skill.description}"
        documents.append(
            DesiredDocument(
                kind="skill",
                capability_id=skill.id,
                item_key=str(skill.id),
                capability_name=skill.name,
                capability_identifier=None,
                item_name=skill.name,
                item_description=skill.description,
                content=content,
                metadata={"version": skill.version},
            )
        )
    return documents


def sync_capability_index(user_id: UUID, *, enqueue: bool = True) -> None:
    embedder = embedding_provider()
    desired = {item.key: item for item in _desired_documents(user_id)}
    existing = list(
        db.session.scalars(
            db.select(RetrievalDocument).where(RetrievalDocument.user_id == user_id)
        )
    )
    by_key = {(item.kind, item.capability_id, item.item_key): item for item in existing}
    for key, document in by_key.items():
        if key not in desired:
            db.session.delete(document)

    pending_ids: list[UUID] = []
    for key, source in desired.items():
        document = by_key.get(key) or RetrievalDocument(
            user_id=user_id,
            kind=source.kind,
            capability_id=source.capability_id,
            item_key=source.item_key,
        )
        changed = document.content_hash != source.content_hash
        document.capability_name = source.capability_name
        document.capability_identifier = source.capability_identifier
        document.item_name = source.item_name
        document.item_description = source.item_description
        document.content = source.content
        document.content_hash = source.content_hash
        document.metadata_json = source.metadata
        if changed:
            document.embedding = None
            document.embedding_model = None
            document.embedding_version = None
            document.embedding_status = "pending"
            document.embedding_attempts = 0
            document.embedding_error = None
            document.embedding_lease_until = None
        db.session.add(document)
        db.session.flush()
        if embedder and (
            document.embedding is None
            or document.embedding_model != embedder.model
            or document.embedding_version != embedder.version
        ):
            pending_ids.append(document.id)
    db.session.commit()
    if enqueue and pending_ids:
        from ..retrieval.embedding_jobs import enqueue_embedding_documents

        enqueue_embedding_documents(pending_ids)


def _tokens(value: str) -> set[str]:
    normalized = value.casefold().replace("_", " ").replace("-", " ")
    return set(TOKEN_PATTERN.findall(normalized))


def _lexical_score(query: str, document: RetrievalDocument) -> float:
    normalized = query.casefold().strip()
    query_tokens = _tokens(normalized)
    if not query_tokens:
        return 0.0
    capability_name = document.capability_name.casefold()
    item_name = document.item_name.casefold().replace("_", " ").replace("-", " ")
    description = document.item_description.casefold()
    name_tokens = _tokens(f"{capability_name} {item_name}")
    description_tokens = _tokens(description)
    name_overlap = len(query_tokens & name_tokens) / len(query_tokens)
    description_overlap = len(query_tokens & description_tokens) / len(query_tokens)
    score = 0.55 * name_overlap + 0.25 * description_overlap
    if normalized == item_name or normalized == capability_name:
        score += 0.7
    elif normalized in item_name or normalized in capability_name:
        score += 0.35
    elif normalized in description:
        score += 0.2
    return min(1.0, score)


def _bounded_score(value: float) -> float:
    if not math.isfinite(value):
        return 0.0
    return max(0.0, min(1.0, value))


def _aggregate(documents: list[tuple[RetrievalDocument, float]]) -> list[dict]:
    grouped: dict[tuple[str, UUID], dict] = {}
    for document, score in sorted(documents, key=lambda item: item[1], reverse=True):
        key = (document.kind, document.capability_id)
        result = grouped.setdefault(
            key,
            {
                "id": (
                    f"mcp:{document.capability_id}"
                    if document.kind == "mcp_tool"
                    else f"skill:{document.capability_name}"
                ),
                "type": "mcp" if document.kind == "mcp_tool" else "skill",
                "name": document.capability_name,
                "score": 0.0,
            },
        )
        result["score"] = max(result["score"], score)
        if document.kind == "mcp_tool":
            result.setdefault("matchedTools", []).append(
                {"name": document.item_name, "score": round(score, 4)}
            )
    results = sorted(grouped.values(), key=lambda item: item["score"], reverse=True)
    for result in results:
        result["score"] = round(result["score"], 4)
        if result["type"] == "mcp":
            result["matchedTools"] = result["matchedTools"][:5]
    return results[:RESULT_LIMIT]


def search_capabilities(
    user_id: UUID,
    query: str,
    *,
    embedder: EmbeddingProvider | None = None,
    reranker: RerankProvider | None = None,
    vector_store: VectorStore | None = None,
) -> list[dict]:
    query = query.strip()
    if not query:
        return []
    embedder = embedder or embedding_provider()
    reranker = reranker or rerank_provider()
    sync_capability_index(user_id)
    documents = list(
        db.session.scalars(
            db.select(RetrievalDocument).where(RetrievalDocument.user_id == user_id)
        )
    )
    lexical = {document.id: _lexical_score(query, document) for document in documents}
    vector_scores: dict[UUID, float] = {}
    embedding_available = False
    if embedder:
        try:
            query_vector = embedder.embed([query])[0]
            hits = (vector_store or PgVectorStore()).search(
                user_id,
                query_vector,
                embedder.model,
                embedder.version,
                VECTOR_RECALL_LIMIT,
            )
            vector_scores = {hit.document_id: hit.score for hit in hits}
            embedding_available = True
        except Exception:
            current_app.logger.warning("Capability vector recall failed", exc_info=True)

    candidates = [
        document
        for document in documents
        if lexical[document.id] > 0 or document.id in vector_scores
    ]
    if not candidates:
        return []
    base_scores = {
        document.id: (
            0.72 * vector_scores.get(document.id, 0.0) + 0.28 * lexical[document.id]
            if embedding_available
            else lexical[document.id]
        )
        for document in candidates
    }
    ranked = sorted(candidates, key=lambda item: base_scores[item.id], reverse=True)
    if embedding_available and reranker and ranked:
        rerank_candidates = ranked[:RERANK_LIMIT]
        try:
            rerank_scores = reranker.rerank(
                query, [document.content for document in rerank_candidates]
            )
            for document, score in zip(rerank_candidates, rerank_scores, strict=True):
                base_scores[document.id] = (
                    0.75 * _bounded_score(score) + 0.25 * base_scores[document.id]
                )
        except Exception:
            current_app.logger.warning("Capability rerank failed", exc_info=True)
    return _aggregate([(document, base_scores[document.id]) for document in ranked])
