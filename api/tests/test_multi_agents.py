from types import SimpleNamespace
from uuid import UUID

from app import create_app
from app.extensions import db
from app.models import AgentEvent, AgentRun, Message
from app.services.agent.preparation import completion_mailbox
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
            json={"to": host["id"], "content": "Continue"},
        )
        assert self_handoff.status_code == 409
        handoff = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": writer["id"], "content": "@Writer draft the launch post"},
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
        run_id = str(run.id)
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
        assert state["status"] == "waiting_user"
        assert state["currentSpeakerId"] is None
        assert state["messages"][-1]["toNodeId"] is None
        assert state["messages"][-1]["runId"] == run_id
        run_detail = client.get(
            f"/api/multi-agents/messages/{state['messages'][-1]['id']}/run", headers=headers
        )
        assert run_detail.status_code == 200
        assert run_detail.get_json()["id"] == run_id
        assert [step["type"] for step in run_detail.get_json()["activity"]] == [
            "run",
            "reasoning",
            "message",
        ]

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
        assert resumed["messages"][-2]["toNodeId"] is None
        assert resumed["messages"][-1]["content"] == "Revise the opening"
        mailbox = completion_mailbox(UUID(writer["conversationId"]))
        assert "[Writer @ User]" in mailbox[0]["content"]


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


def test_user_message_preserves_existing_handoff_order(tmp_path):
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
        host = next(member for member in task["members"] if member["isHost"])
        writer = next(member for member in task["members"] if member["key"] == "writer")
        reviewer = next(member for member in task["members"] if member["key"] == "reviewer")

        client.post(f"/api/multi-agents/tasks/{task['id']}/start", headers=headers)
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": writer["id"], "content": "Draft first"},
        )
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/user-messages",
            headers=headers,
            json={"content": "Also consider this"},
        )
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["currentSpeakerId"] == writer["id"]
        assert next(item for item in state["members"] if item["id"] == host["id"])[
            "status"
        ] == "queued"

        client.post(f"/api/multi-agents/nodes/{writer['id']}/start", headers=headers)
        client.post(
            f"/api/multi-agents/nodes/{writer['id']}/messages",
            headers=headers,
            json={"to": reviewer["id"], "content": "Review after the host"},
        )
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["currentSpeakerId"] == host["id"]
        assert next(item for item in state["members"] if item["id"] == reviewer["id"])[
            "status"
        ] == "queued"

        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": reviewer["id"], "content": "Continue"},
        )
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["currentSpeakerId"] == reviewer["id"]


def test_agent_pause_preserves_pending_speakers(tmp_path):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        headers = _setup(client)
        agent = _create_team(client, headers)
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={"workspacePath": str(tmp_path), "request": "Debate a topic"},
        ).get_json()
        host = next(member for member in task["members"] if member["isHost"])
        writer = next(member for member in task["members"] if member["key"] == "writer")

        client.post(f"/api/multi-agents/tasks/{task['id']}/start", headers=headers)
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/user-messages",
            headers=headers,
            json={"content": "Increase the intensity"},
        )
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": writer["id"], "content": "Respond next"},
        )
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)
        paused = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": "user", "content": "Do you want me to continue?"},
        )
        assert paused.status_code == 201
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["status"] == "waiting_user"
        assert next(item for item in state["members"] if item["id"] == writer["id"])[
            "status"
        ] == "queued"

        client.post(
            f"/api/multi-agents/nodes/{host['id']}/user-messages",
            headers=headers,
            json={"content": "Continue"},
        )
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["currentSpeakerId"] == host["id"]
        assert next(item for item in state["members"] if item["id"] == writer["id"])[
            "status"
        ] == "queued"

        started = client.post(
            f"/api/multi-agents/nodes/{host['id']}/start", headers=headers
        ).get_json()
        assert "Pending speakers after this turn: Writer" in started["prompt"]
        client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": writer["id"], "content": "Continue the debate"},
        )
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["currentSpeakerId"] == writer["id"]


def test_running_node_can_be_requeued_after_transient_transport_conflict(tmp_path):
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
        host = next(member for member in task["members"] if member["isHost"])
        client.post(f"/api/multi-agents/tasks/{task['id']}/start", headers=headers)
        client.post(f"/api/multi-agents/nodes/{host['id']}/start", headers=headers)

        retried = client.post(
            f"/api/multi-agents/nodes/{host['id']}/retry", headers=headers
        )
        assert retried.status_code == 200
        state = retried.get_json()
        assert state["status"] == "running"
        assert state["currentSpeakerId"] == host["id"]


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
            json={"to": writer["id"], "content": "Draft the post"},
        )
        client.post(f"/api/multi-agents/nodes/{writer['id']}/start", headers=headers)
        forced_handoff = client.post(
            f"/api/multi-agents/nodes/{writer['id']}/messages",
            headers=headers,
            json={"to": reviewer["id"], "content": "Review the draft"},
        )
        assert forced_handoff.status_code == 201
        state = client.get(f"/api/multi-agents/tasks/{task['id']}", headers=headers).get_json()
        assert state["executionCount"] == 2
        assert state["currentSpeakerId"] == host["id"]

        forced_start = client.post(
            f"/api/multi-agents/nodes/{host['id']}/start", headers=headers
        )
        assert "with to='user'" in forced_start.get_json()["prompt"]
        delegation = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": reviewer["id"], "content": "Continue reviewing"},
        )
        assert delegation.status_code == 409
        finished_response = client.post(
            f"/api/multi-agents/nodes/{host['id']}/messages",
            headers=headers,
            json={"to": "user", "content": "Best available launch post"},
        )
        assert finished_response.status_code == 201
        finished = client.get(
            f"/api/multi-agents/tasks/{task['id']}", headers=headers
        ).get_json()
        assert finished["status"] == "waiting_user"
        assert finished["executionCount"] == 3
