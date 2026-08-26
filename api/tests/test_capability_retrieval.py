from app import create_app
from app.extensions import db
from app.models import McpServer, RetrievalDocument, SkillPackage, User
from app.services.capabilities.retrieval import search_capabilities, sync_capability_index
from app.services.retrieval import VectorHit
from app.services.retrieval.embedding_jobs import process_embedding_documents


def create_test_app():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    return app


def add_user(email: str, display_name: str) -> User:
    user = User(email=email, display_name=display_name)
    user.set_password("test-password")
    db.session.add(user)
    db.session.commit()
    return user


def add_capabilities(user: User) -> tuple[McpServer, SkillPackage]:
    server = McpServer(
        user_id=user.id,
        name="GitHub",
        identifier="github",
        transport="http",
        configuration_encrypted=b"unused",
        enabled=True,
        tools=[
            {
                "name": "create_pull_request",
                "description": "Create a pull request from one branch to another",
                "inputSchema": {"type": "object", "properties": {"title": {"type": "string"}}},
            },
            {"name": "list_issues", "description": "List repository issues"},
        ],
    )
    skill = SkillPackage(
        user_id=user.id,
        name="release-notes",
        description="Write concise release notes from git history",
        archive_key=f"skills/{user.id}/release-notes.zip",
        sha256="0" * 64,
        size=1,
        enabled=True,
    )
    db.session.add_all([server, skill])
    db.session.commit()
    return server, skill


def auth_headers(client, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"email": email, "password": "test-password"},
    )
    return {"Authorization": f"Bearer {response.get_json()['tokens']['accessToken']}"}


def test_lexical_capability_search_aggregates_mcp_tools_without_schemas():
    app = create_test_app()
    with app.app_context():
        user = add_user("retrieval@example.com", "Retrieval")
        add_capabilities(user)

        results = search_capabilities(user.id, "create github pull request")

        assert results[0]["type"] == "mcp"
        assert results[0]["name"] == "GitHub"
        assert results[0]["matchedTools"][0]["name"] == "create_pull_request"
        assert "inputSchema" not in results[0]["matchedTools"][0]
        assert search_capabilities(user.id, "   ") == []


def test_capability_search_endpoint_returns_results():
    app = create_test_app()
    with app.app_context():
        user = add_user("route@example.com", "Route")
        add_capabilities(user)

    client = app.test_client()
    response = client.post(
        "/api/capabilities/search",
        headers=auth_headers(client, "route@example.com"),
        json={"query": "release notes"},
    )

    assert response.status_code == 200
    assert response.get_json()["results"][0]["type"] == "skill"


def test_disabled_capability_is_removed_from_index():
    app = create_test_app()
    with app.app_context():
        user = add_user("disabled@example.com", "Disabled")
        server, skill = add_capabilities(user)
        sync_capability_index(user.id)
        assert db.session.query(RetrievalDocument).count() == 3

        server.enabled = False
        skill.enabled = False
        db.session.commit()
        sync_capability_index(user.id)

        assert db.session.query(RetrievalDocument).count() == 0
        assert search_capabilities(user.id, "github") == []


def test_content_hash_avoids_duplicate_embedding_calls(monkeypatch):
    class FakeEmbeddingProvider:
        model = "fake-embedding"
        version = "v1"

        def __init__(self):
            self.calls = 0

        def embed(self, texts: list[str]) -> list[list[float]]:
            self.calls += 1
            return [[1.0, 0.0, 0.0] for _ in texts]

    app = create_test_app()
    with app.app_context():
        user = add_user("hash@example.com", "Hash")
        add_capabilities(user)
        provider = FakeEmbeddingProvider()
        monkeypatch.setattr(
            "app.services.retrieval.embedding_jobs.embedding_provider", lambda: provider
        )

        sync_capability_index(user.id, enqueue=False)
        documents = db.session.scalars(db.select(RetrievalDocument)).all()
        for document in documents:
            document.embedding_status = "queued"
        db.session.commit()
        process_embedding_documents([document.id for document in documents])
        process_embedding_documents([document.id for document in documents])

        assert provider.calls == 1
        assert all(document.embedding_model == "fake-embedding" for document in documents)
        assert all(document.embedding_version == "v1" for document in documents)


def test_embedding_failure_falls_back_to_lexical_search():
    class FailingEmbeddingProvider:
        model = "unavailable-embedding"
        version = "v1"

        def embed(self, texts: list[str]) -> list[list[float]]:
            raise RuntimeError("provider unavailable")

    app = create_test_app()
    with app.app_context():
        user = add_user("fallback@example.com", "Fallback")
        add_capabilities(user)

        results = search_capabilities(
            user.id,
            "create pull request",
            embedder=FailingEmbeddingProvider(),
        )

        assert results[0]["name"] == "GitHub"
        assert results[0]["matchedTools"][0]["name"] == "create_pull_request"


def test_rerank_failure_preserves_vector_and_lexical_ranking():
    class FakeEmbeddingProvider:
        model = "fake-embedding"
        version = "v1"

        def embed(self, texts: list[str]) -> list[list[float]]:
            return [[1.0, 0.0, 0.0] for _ in texts]

    class FakeVectorStore:
        def search(self, user_id, vector, model, version, limit):
            documents = db.session.scalars(
                db.select(RetrievalDocument).where(RetrievalDocument.user_id == user_id)
            )
            return [VectorHit(document_id=document.id, score=0.8) for document in documents]

    class FailingRerankProvider:
        def rerank(self, query: str, documents: list[str]) -> list[float]:
            raise RuntimeError("provider unavailable")

    app = create_test_app()
    with app.app_context():
        user = add_user("rerank@example.com", "Rerank")
        add_capabilities(user)

        results = search_capabilities(
            user.id,
            "release notes",
            embedder=FakeEmbeddingProvider(),
            reranker=FailingRerankProvider(),
            vector_store=FakeVectorStore(),
        )

        assert results[0]["type"] == "skill"
