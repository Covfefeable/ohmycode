from types import SimpleNamespace
from uuid import UUID

from app import create_app
from app.extensions import db
from app.models import AgentEvent, AgentRun, Message
from app.services.multi_agents import planner


def test_planner_repairs_an_invalid_generated_team(monkeypatch):
    model = SimpleNamespace(
        base_url="https://models.example/v1",
        model="example-model",
        api_key_encrypted="encrypted",
    )
    monkeypatch.setattr(planner, "get_model_configuration", lambda *_args: model)
    monkeypatch.setattr(planner, "decrypt_api_key", lambda _value: "secret")
    responses = iter(
        [
            {"choices": [{"message": {"content": '{"title":"Bad","members":[{"key":"host"}]}'}}]},
            {
                "choices": [
                    {
                        "message": {
                            "content": (
                                '{"title":"Writing room","members":['
                                '{"key":"host","name":"Host","role":"Coordinator",'
                                '"instructions":"Coordinate","isHost":true},'
                                '{"key":"writer","name":"Writer","role":"Writer",'
                                '"instructions":"Draft","isHost":false}]}'
                            )
                        }
                    }
                ]
            },
        ]
    )
    requests = []

    class Response:
        status_code = 200

        def __init__(self, payload):
            self.payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self.payload

    def post(*_args, **kwargs):
        requests.append(kwargs["json"])
        return Response(next(responses))

    monkeypatch.setattr(planner.httpx, "post", post)

    result = planner.generate_plan(UUID(int=1), "Create and review an article")

    assert [member["key"] for member in result["members"]] == ["host", "writer"]
    assert len(requests) == 2
    assert "did not match" in requests[1]["messages"][-1]["content"]


def _setup(client):
    token = client.post(
        "/api/auth/register",
        json={"email": "team@example.com", "displayName": "Team", "password": "secret123"},
    ).get_json()["tokens"]["accessToken"]
    return {
        "Authorization": f"Bearer {token}",
        "X-OhMyCode-Device-Id": "device-a",
        "X-OhMyCode-Device-Name": "Test%20device",
    }


def _create_team(client, headers):
    response = client.post(
        "/api/multi-agents",
        headers=headers,
        json={
            "name": "Writing room",
            "description": "Create and review an article",
            "division": "A host coordinates a writer and reviewer",
            "team": {
                "title": "Writing room",
                "members": [
                    {
                        "key": "host",
                        "name": "Host",
                        "role": "Coordinator",
                        "instructions": "Coordinate and finish",
                        "isHost": True,
                    },
                    {
                        "key": "writer",
                        "name": "Writer",
                        "role": "Writer",
                        "instructions": "Write the draft",
                        "isHost": False,
                    },
                    {
                        "key": "reviewer",
                        "name": "Reviewer",
                        "role": "Reviewer",
                        "instructions": "Review the draft",
                        "isHost": False,
                    },
                ],
            },
        },
    )
    assert response.status_code == 201
    return response.get_json()


def test_host_driven_group_chat_lifecycle(tmp_path):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        headers = _setup(client)
        agent = _create_team(client, headers)
        assert sum(member["isHost"] for member in agent["templateTeam"]["members"]) == 1
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={"workspacePath": str(tmp_path), "request": "Write a concise launch post"},
        ).get_json()
        host = next(member for member in task["members"] if member["isHost"])
        writer = next(member for member in task["members"] if member["key"] == "writer")
        assert task["messages"][0]["content"] == "Write a concise launch post"

        started = client.post(f"/api/multi-agents/tasks/{task['id']}/start", headers=headers)
        assert started.get_json()["currentSpeakerId"] == host["id"]
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        self_handoff = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"toNodeId": host["id"], "content": "Continue"},
        )
        assert self_handoff.status_code == 409
        handoff = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"toNodeId": writer["id"], "content": "@Writer draft the launch post"},
        )
        assert handoff.status_code == 201
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["currentSpeakerId"] == writer["id"]
        assert len(state["messages"]) == 2

        writer_start = client.post(
            f"/api/multi-agents/nodes/{writer['id']}/start", headers=headers
        ).get_json()
        run = AgentRun(conversation_id=UUID(writer_start["conversationId"]), status="completed")
        db.session.add(run)
        db.session.flush()
        db.session.add_all(
            [
                AgentEvent(
                    run=run,
                    sequence=1,
                    event_type="run.started",
                    payload={},
                ),
                AgentEvent(
                    run=run,
                    sequence=2,
                    event_type="reasoning.completed",
                    payload={"content": "Planning the draft"},
                ),
                AgentEvent(
                    run=run,
                    sequence=3,
                    event_type="message.progress",
                    payload={"content": "Draft complete"},
                ),
            ]
        )
        run.last_event_sequence = 3
        db.session.commit()
        client.post(
            f"/api/multi-agents/nodes/{writer['id']}/complete",
            headers=headers,
            json={"output": {"content": "Draft complete"}},
        )
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        writer_state = next(member for member in state["members"] if member["id"] == writer["id"])
        assert [step["type"] for step in writer_state["finalOutput"]["activity"]] == [
            "run",
            "reasoning",
            "message",
        ]
        assert state["currentSpeakerId"] == host["id"]
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        finished = client.post(
            f"/api/multi-agents/nodes/{host['id']}/finish",
            headers=headers,
            json={"content": "Final launch post"},
        ).get_json()
        assert finished["status"] == "completed"
        assert finished["messages"][-1]["type"] == "final"

        follow_up = client.post(
            f"/api/multi-agents/nodes/{writer['id']}/user-messages",
            headers=headers,
            json={"content": "Revise the opening"},
        )
        assert follow_up.status_code == 201
        resumed = client.get(
            f"/api/multi-agents/tasks/{task['id']}", headers=headers
        ).get_json()
        assert resumed["status"] == "running"
        assert resumed["currentSpeakerId"] == writer["id"]
        assert resumed["messages"][-2]["type"] == "final"
        assert resumed["messages"][-1]["content"] == "Revise the opening"


def test_user_message_queues_target_and_host_recovers(tmp_path):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        headers = _setup(client)
        agent = _create_team(client, headers)
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={"workspacePath": str(tmp_path), "request": "Prepare content"},
        ).get_json()
        task = client.post(
            f"/api/multi-agents/tasks/{task['id']}/start", headers=headers
        ).get_json()
        host = next(member for member in task["members"] if member["isHost"])
        reviewer = next(member for member in task["members"] if member["key"] == "reviewer")
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        client.post(
            f"/api/multi-agents/nodes/{reviewer['id']}/user-messages",
            headers=headers,
            json={"content": "Check the tone next"},
        )
        queued = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert (
            next(item for item in queued["members"] if item["id"] == reviewer["id"])["status"]
            == "queued"
        )
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/complete",
            headers=headers,
            json={"output": {"content": "No explicit handoff"}},
        )
        resumed = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert resumed["status"] == "running"
        assert resumed["currentSpeakerId"] == reviewer["id"]

        db.session.add(
            Message(
                conversation_id=UUID(host["conversationId"]),
                role="assistant",
                content="Internal host context",
            )
        )
        db.session.commit()
        before_stop_message_ids = [item["id"] for item in resumed["messages"]]
        stopped = client.post(
            f"/api/multi-agents/tasks/{task['id']}/stop", headers=headers
        ).get_json()
        assert [item["id"] for item in stopped["messages"]] == before_stop_message_ids
        assert (
            db.session.scalar(
                db.select(db.func.count(Message.id)).where(
                    Message.conversation_id == UUID(host["conversationId"])
                )
            )
            == 1
        )

        restarted = client.post(
            f"/api/multi-agents/tasks/{task['id']}/start", headers=headers
        ).get_json()
        assert len(restarted["messages"]) == 1
        assert restarted["messages"][0]["id"] not in before_stop_message_ids
        assert restarted["messages"][0]["content"] == task["request"]
        assert (
            db.session.scalar(
                db.select(db.func.count(Message.id)).where(
                    Message.conversation_id == UUID(host["conversationId"])
                )
            )
            == 0
        )


def test_remote_service_treats_client_workspace_path_as_opaque():
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        headers = _setup(client)
        agent = _create_team(client, headers)
        workspace_path = r"C:\Users\admin\Documents\repos\client-only-project"
        response = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={
                "workspacePath": workspace_path,
                "workspaceName": "client-only-project",
                "request": "Inspect the client workspace",
            },
        )

        assert response.status_code == 201
        task = response.get_json()
        assert task["workspacePath"] == workspace_path
        assert task["title"] == "client-only-project"


def test_execution_limit_forces_host_summary(tmp_path):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        headers = _setup(client)
        agent = _create_team(client, headers)
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={
                "workspacePath": str(tmp_path),
                "request": "Prepare a launch post",
                "executionLimit": 2,
            },
        ).get_json()
        host = next(member for member in task["members"] if member["isHost"])
        writer = next(member for member in task["members"] if member["key"] == "writer")
        reviewer = next(member for member in task["members"] if member["key"] == "reviewer")
        assert task["executionLimit"] == 2
        assert task["executionCount"] == 0

        client.post(f"/api/multi-agents/tasks/{task['id']}/start", headers=headers)
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"toNodeId": writer["id"], "content": "Draft the post"},
        )
        client.post(f"/api/multi-agents/nodes/{writer['id']}/start", headers=headers)
        forced_handoff = client.post(
            f"/api/multi-agents/nodes/{writer['id']}/messages",
            headers=headers,
            json={"toNodeId": reviewer["id"], "content": "Review the draft"},
        )
        assert forced_handoff.status_code == 201
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["executionCount"] == 2
        assert state["currentSpeakerId"] == host["id"]

        forced_start = client.post(
            f"/api/multi-agents/nodes/{host['id']}/start", headers=headers
        )
        assert "must now call finish_collaboration" in forced_start.get_json()["prompt"]
        delegation = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"toNodeId": reviewer["id"], "content": "Continue reviewing"},
        )
        assert delegation.status_code == 409
        finished = client.post(
            f"/api/multi-agents/nodes/{host['id']}/finish",
            headers=headers,
            json={"content": "Best available launch post"},
        ).get_json()
        assert finished["status"] == "completed"
        assert finished["executionCount"] == 3
