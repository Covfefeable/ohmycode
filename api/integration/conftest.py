"""Real PostgreSQL tests. Each test owns a temporary schema, never the public schema."""

import os
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app import create_app
from app.config import TestingConfig
from app.extensions import db
from app.models import Conversation, ModelConfiguration, Project, User
from app.services.model_credentials import encrypt_api_key


@pytest.fixture
def database_schema():
    url = os.environ.get("TEST_DATABASE_URL", "")
    if not url or make_url(url).get_backend_name() != "postgresql":
        pytest.fail("Set TEST_DATABASE_URL to a PostgreSQL test database; see docs/testing.md")
    schema = f"test_{uuid4().hex}"
    admin = create_engine(url)
    with admin.begin() as connection:
        connection.execute(text(f'CREATE SCHEMA "{schema}"'))
    try:
        yield SimpleNamespace(url=url, name=schema, engine=admin)
    finally:
        with admin.begin() as connection:
            connection.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        admin.dispose()


@pytest.fixture
def workspace(monkeypatch, database_schema):
    monkeypatch.setattr(TestingConfig, "SQLALCHEMY_DATABASE_URI", database_schema.url)
    monkeypatch.setattr(
        TestingConfig,
        "SQLALCHEMY_ENGINE_OPTIONS",
        {"execution_options": {"schema_translate_map": {None: database_schema.name}}},
    )
    app = create_app("testing")
    queued = []
    monkeypatch.setattr("app.services.agent.executions.dispatch_execution", queued.append)
    try:
        with app.app_context():
            db.create_all()
            user = User(
                email="integration@example.com", display_name="Test", password_hash="unused"
            )
            db.session.add(user)
            db.session.flush()
            project = Project(
                user_id=user.id, device_id="test", device_name="Test", name="Repo", path="/repo"
            )
            db.session.add(project)
            db.session.flush()
            conversation = Conversation(project_id=project.id)
            model = ModelConfiguration(
                user_id=user.id,
                name="Test",
                base_url="https://example.com/v1",
                model="test",
                api_key_encrypted=encrypt_api_key("test-key"),
                context_length=4096,
            )
            db.session.add_all([conversation, model])
            db.session.commit()
            state = SimpleNamespace(
                app=app,
                user=user.id,
                conversation=conversation.id,
                model=str(model.id),
                queued=queued,
            )
        yield state
    finally:
        with app.app_context():
            db.session.remove()
            db.engine.dispose()
