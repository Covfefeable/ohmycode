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


def test_history_around_message_is_bounded_and_pages_both_directions(history_client):
    client, headers, (conversation_id, _, foreign_id) = history_client
    url = f"/api/projects/conversations/{conversation_id}/history"
    page = client.get(url, headers=headers, query_string={"around": str(UUID(int=51))}).get_json()
    assert [int(item["content"]) for item in page["messages"]] == list(range(31, 72))
    older = client.get(
        url, headers=headers, query_string={"before": page["olderCursor"]}
    ).get_json()
    newer = client.get(url, headers=headers, query_string={"after": page["newerCursor"]}).get_json()
    assert [int(item["content"]) for item in older["messages"]] == list(range(1, 31))
    assert [int(item["content"]) for item in newer["messages"]] == list(range(72, 102))
    assert newer["newerCursor"] is None
    for options in [
        {"around": str(foreign_id)},
        {"after": "invalid"},
        {"around": str(UUID(int=51)), "before": str(UUID(int=50))},
    ]:
        assert client.get(url, headers=headers, query_string=options).status_code == 422


def test_message_search_finds_unloaded_history_and_wraps_in_both_directions(history_client):
    client, headers, (conversation_id, _, foreign_id) = history_client
    url = f"/api/projects/conversations/{conversation_id}/search"
    matches = [index for index in range(1, 102) if "1" in str(index)]
    first = client.get(url, headers=headers, query_string={"q": "1"}).get_json()
    assert first == {"messageId": str(UUID(int=matches[0])), "position": 1, "total": len(matches)}
    next_match = client.get(
        url, headers=headers, query_string={"q": "1", "at": first["messageId"], "direction": "next"}
    ).get_json()
    assert next_match["messageId"] == str(UUID(int=matches[1]))
    assert next_match["position"] == 2
    previous = client.get(
        url,
        headers=headers,
        query_string={"q": "1", "at": first["messageId"], "direction": "previous"},
    ).get_json()
    assert previous["position"] == len(matches)
    assert previous["messageId"] == str(UUID(int=matches[-1]))
    exact = client.get(
        url, headers=headers, query_string={"q": "1", "at": str(UUID(int=51))}
    ).get_json()
    assert exact["messageId"] == str(UUID(int=51))
    assert client.get(url, headers=headers, query_string={"q": " "}).get_json()["total"] == 0
    assert (
        client.get(url, headers=headers, query_string={"q": "unmatched"}).get_json()["messageId"]
        is None
    )
    for options in [{"q": "1", "at": str(foreign_id)}, {"q": "1", "direction": "invalid"}]:
        assert client.get(url, headers=headers, query_string=options).status_code == 422
    assert (
        client.get(
            url, headers={**headers, "X-OhMyCode-Device-Id": "other"}, query_string={"q": "1"}
        ).status_code
        == 404
    )


def test_global_search_returns_latest_matching_message_not_only_conversation(history_client):
    client, headers, (conversation_id, _, _) = history_client
    results = client.get(
        "/api/projects/conversations/search", headers=headers, query_string={"q": "1"}
    ).get_json()
    assert results[0]["conversation"]["id"] == str(conversation_id)
    assert results[0]["messageId"] == str(UUID(int=101))
    title = client.get(
        "/api/projects/conversations/search", headers=headers, query_string={"q": "History"}
    ).get_json()
    assert title[0]["messageId"] is None
    assert title[0]["snippet"] is None
    assert (
        client.get(
            "/api/projects/conversations/search", headers=headers, query_string={"q": "%"}
        ).get_json()
        == []
    )
