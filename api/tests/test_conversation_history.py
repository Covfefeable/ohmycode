from datetime import UTC, datetime
from uuid import UUID, uuid4

import pytest

from app import create_app
from app.extensions import db
from app.models import AgentRun, Conversation, Message, Project, User


@pytest.fixture
def history_client():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "history@example.com",
                "displayName": "History",
                "password": "secret123",
            },
        ).get_json()
        headers = {
            "Authorization": f"Bearer {registration['tokens']['accessToken']}",
            "X-OhMyCode-Device-Id": "history-device",
            "X-OhMyCode-Device-Name": "History",
        }
        with app.app_context():
            user = db.session.scalar(db.select(User))
            project = Project(
                user_id=user.id,
                name="History",
                path="/history",
                device_id="history-device",
                device_name="History",
            )
            conversation = Conversation(project=project, title="History")
            other = Conversation(project=project, title="Other")
            db.session.add_all([conversation, other])
            db.session.flush()
            run = AgentRun(conversation_id=conversation.id)
            db.session.add(run)
            db.session.flush()
            for index in range(1, 102):
                db.session.add(
                    Message(
                        id=UUID(int=index),
                        conversation_id=conversation.id,
                        role="assistant" if index % 2 else "user",
                        content=str(index),
                        created_at=datetime(2026, 10, 18, tzinfo=UTC),
                        agent_run_id=run.id if index >= 100 else None,
                    )
                )
            foreign_message = Message(conversation_id=other.id, role="user", content="Other")
            db.session.add(foreign_message)
            db.session.commit()
            ids = conversation.id, run.id, foreign_message.id
        yield client, headers, ids


def test_history_keyset_has_no_gaps_or_duplicates_with_equal_timestamps(history_client):
    client, headers, (conversation_id, _, _) = history_client
    url = f"/api/projects/conversations/{conversation_id}/history"
    contents = []
    cursor = None
    lengths = []
    while True:
        page = client.get(
            url, headers=headers, query_string={"before": cursor} if cursor else {}
        ).get_json()
        contents = [int(message["content"]) for message in page["messages"]] + contents
        lengths.append(len(page["messages"]))
        cursor = page["olderCursor"]
        if not cursor:
            break
    assert lengths == [40, 40, 21]
    assert contents == list(range(1, 102))
    # UI paging must not truncate the existing full-history contract used for model input.
    full = client.get(f"/api/projects/conversations/{conversation_id}", headers=headers).get_json()
    assert len(full["messages"]) == 101


def test_history_cursor_and_device_boundaries(history_client):
    client, headers, (conversation_id, _, foreign_id) = history_client
    url = f"/api/projects/conversations/{conversation_id}/history"
    for cursor in ["invalid", str(uuid4()), str(foreign_id)]:
        assert client.get(url, headers=headers, query_string={"before": cursor}).status_code == 422
    assert (
        client.get(url, headers={**headers, "X-OhMyCode-Device-Id": "another"}).status_code == 404
    )
    registration = client.post(
        "/api/auth/register",
        json={
            "email": "other-history@example.com",
            "displayName": "Other",
            "password": "secret123",
        },
    ).get_json()
    assert (
        client.get(
            url,
            headers={**headers, "Authorization": f"Bearer {registration['tokens']['accessToken']}"},
        ).status_code
        == 404
    )


def test_turn_result_does_not_return_prior_turns(history_client):
    client, headers, (conversation_id, run_id, _) = history_client
    page = client.get(
        f"/api/projects/conversations/{conversation_id}/history",
        headers=headers,
        query_string={"turnId": str(run_id)},
    ).get_json()
    assert [message["content"] for message in page["messages"]] == ["100", "101"]
    assert page["olderCursor"] is None
