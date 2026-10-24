import base64
from io import BytesIO
from uuid import UUID, uuid4
from zipfile import ZipFile

import pytest

from app import create_app
from app.extensions import db
from app.models import McpServer, User
from app.services.capabilities.mcp import list_mcp_servers, runtime_mcp_servers, save_mcp_server
from app.services.capabilities.skills import download_skill, save_skill
from app.services.errors import ServiceError


@pytest.fixture
def users(monkeypatch):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        owners = [
            User(email=f"user-{index}@example.com", display_name="Test", password_hash="unused")
            for index in range(2)
        ]
        db.session.add_all(owners)
        db.session.commit()
        monkeypatch.setattr(
            "app.services.capabilities.mcp.sync_capability_index", lambda _, **kwargs: None
        )
        monkeypatch.setattr(
            "app.services.capabilities.skills.sync_capability_index", lambda _, **kwargs: None
        )
        yield [owner.id for owner in owners]


def http_server(**configuration):
    return {
        "name": "Search",
        "identifier": "search",
        "transport": "http",
        "configuration": {"url": "https://example.com/mcp", **configuration},
    }


def test_public_mcp_configuration_hides_secrets_and_edit_preserves_omitted_secrets(users):
    owner, other = users
    saved = save_mcp_server(owner, http_server(headers={"Authorization": "test-private-value"}))
    assert saved["configuration"]["headers"] == [{"key": "Authorization", "hasValue": True}]
    assert "test-private-value" not in str(list_mcp_servers(owner))
    assert list_mcp_servers(other) == []
    save_mcp_server(owner, http_server(), UUID(saved["id"]))
    assert runtime_mcp_servers(owner)[0]["configuration"]["headers"] == {
        "Authorization": "test-private-value"
    }
    stored = db.session.get(McpServer, UUID(saved["id"]))
    assert b"test-private-value" not in stored.configuration_encrypted


def test_editing_a_missing_mcp_does_not_create_a_different_server(users):
    with pytest.raises(ServiceError, match="not_found"):
        save_mcp_server(users[0], http_server(), uuid4())
    assert list_mcp_servers(users[0]) == []


def test_mcp_defaults_enabled_and_can_be_disabled_and_reenabled(users):
    owner = users[0]
    payload = http_server(headers={"Authorization": "test-private-value"})
    saved = save_mcp_server(owner, payload)
    assert saved["enabled"] is True
    server_id = UUID(saved["id"])
    disabled = save_mcp_server(owner, {**http_server(), "enabled": False}, server_id)
    assert disabled["enabled"] is False
    assert runtime_mcp_servers(owner) == []
    assert list_mcp_servers(owner)[0]["enabled"] is False
    save_mcp_server(owner, {**http_server(), "enabled": True}, server_id)
    assert runtime_mcp_servers(owner)[0]["configuration"]["headers"] == {
        "Authorization": "test-private-value"
    }


def test_mcp_configuration_cannot_be_changed_by_another_account(users):
    saved = save_mcp_server(users[0], http_server())
    with pytest.raises(ServiceError, match="not_found"):
        save_mcp_server(users[1], http_server(), UUID(saved["id"]))


@pytest.mark.parametrize(
    "url", ["file:///tmp/server", "http://", "https://example.com:invalid", "http://[invalid"]
)
def test_mcp_invalid_urls_are_validation_errors(users, url):
    with pytest.raises(ServiceError, match="validation_error"):
        save_mcp_server(users[0], http_server(url=url))


@pytest.mark.parametrize("content", [b"not zip", b"PKgarbage", b"PK\x03\x04truncated"])
def test_corrupt_skill_archives_are_rejected_before_storage(users, monkeypatch, content):
    writes = []
    monkeypatch.setattr(
        "app.services.capabilities.skills.put_object", lambda *args: writes.append(args)
    )
    with pytest.raises(ServiceError, match="invalid_skill_archive"):
        save_skill(users[0], {"name": "Test", "archive": base64.b64encode(content).decode()})
    assert writes == []


def test_skill_archive_round_trip_is_account_scoped(users, monkeypatch):
    archive = BytesIO()
    with ZipFile(archive, "w") as package:
        package.writestr("SKILL.md", "# Test skill\n")
    objects = {}
    monkeypatch.setattr(
        "app.services.capabilities.skills.put_object",
        lambda key, content, mime: objects.update({key: content}),
    )
    monkeypatch.setattr(
        "app.services.capabilities.skills.get_object", lambda key: (objects[key], "application/zip")
    )
    saved = save_skill(
        users[0], {"name": "Test", "archive": base64.b64encode(archive.getvalue()).decode()}
    )
    content, digest = download_skill(users[0], UUID(saved["id"]))
    assert content == archive.getvalue() and digest == saved["sha256"]
    with pytest.raises(ServiceError, match="not_found"):
        download_skill(users[1], UUID(saved["id"]))
