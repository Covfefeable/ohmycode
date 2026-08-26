from dataclasses import dataclass
from typing import Protocol

import httpx
from flask import current_app


class EmbeddingProvider(Protocol):
    @property
    def model(self) -> str: ...

    @property
    def version(self) -> str: ...

    def embed(self, texts: list[str]) -> list[list[float]]: ...


class RerankProvider(Protocol):
    def rerank(self, query: str, documents: list[str]) -> list[float]: ...


@dataclass(frozen=True)
class OpenAICompatibleEmbeddingProvider:
    base_url: str
    api_key: str
    model: str
    version: str
    dimensions: int | None = None

    def embed(self, texts: list[str]) -> list[list[float]]:
        payload: dict = {"model": self.model, "input": texts}
        if self.dimensions:
            payload["dimensions"] = self.dimensions
        response = httpx.post(
            f"{self.base_url.rstrip('/')}/embeddings",
            headers={"Authorization": f"Bearer {self.api_key}"},
            json=payload,
            timeout=current_app.config["RETRIEVAL_HTTP_TIMEOUT"],
        )
        response.raise_for_status()
        data = sorted(response.json().get("data") or [], key=lambda item: item.get("index", 0))
        vectors = [item.get("embedding") for item in data]
        if len(vectors) != len(texts) or any(not isinstance(vector, list) for vector in vectors):
            raise ValueError("invalid_embedding_response")
        return vectors


@dataclass(frozen=True)
class HttpRerankProvider:
    url: str
    api_key: str
    model: str

    def rerank(self, query: str, documents: list[str]) -> list[float]:
        response = httpx.post(
            self.url,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={
                "model": self.model,
                "query": query,
                "documents": documents,
                "top_n": len(documents),
            },
            timeout=current_app.config["RETRIEVAL_HTTP_TIMEOUT"],
        )
        response.raise_for_status()
        scores = [0.0] * len(documents)
        for result in response.json().get("results") or []:
            index = result.get("index")
            score = result.get("relevance_score", result.get("score"))
            if isinstance(index, int) and 0 <= index < len(scores) and score is not None:
                scores[index] = float(score)
        return scores


def embedding_provider() -> EmbeddingProvider | None:
    base_url = str(current_app.config.get("EMBEDDING_BASE_URL") or "").strip()
    api_key = str(current_app.config.get("EMBEDDING_API_KEY") or "").strip()
    model = str(current_app.config.get("EMBEDDING_MODEL") or "").strip()
    version = str(current_app.config.get("EMBEDDING_MODEL_VERSION") or "").strip()
    if not base_url or not api_key or not model or not version:
        return None
    dimensions_value = str(current_app.config.get("EMBEDDING_DIMENSIONS") or "").strip()
    dimensions = int(dimensions_value) if dimensions_value.isdigit() else None
    return OpenAICompatibleEmbeddingProvider(
        base_url=base_url,
        api_key=api_key,
        model=model,
        version=version,
        dimensions=dimensions,
    )


def rerank_provider() -> RerankProvider | None:
    url = str(current_app.config.get("RERANK_URL") or "").strip()
    api_key = str(current_app.config.get("RERANK_API_KEY") or "").strip()
    model = str(current_app.config.get("RERANK_MODEL") or "").strip()
    if not url or not api_key or not model:
        return None
    return HttpRerankProvider(url=url, api_key=api_key, model=model)
