from app import create_app
from app.extensions import db


def test_multi_agent_dag_lifecycle(tmp_path):
    app = create_app("testing")
    with app.app_context():
        db.create_all()

    with app.test_client() as client:
        registration = client.post(
            "/api/auth/register",
            json={
                "email": "multi-agent@example.com",
                "displayName": "Workflow User",
                "password": "secret123",
            },
        )
        token = registration.get_json()["tokens"]["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        agent = client.post(
            "/api/multi-agents",
            headers=headers,
            json={
                "name": "Workspace Agent",
                "description": "Implement and verify a feature",
                "division": "Backend and frontend in parallel, followed by verification",
                "flow": {
                    "title": "Feature workflow",
                    "nodes": [
                        {
                            "key": "api",
                            "name": "API",
                            "role": "Backend",
                            "instructions": "Build API",
                        },
                        {"key": "ui", "name": "UI", "role": "Frontend", "instructions": "Build UI"},
                        {
                            "key": "verify",
                            "name": "Verify",
                            "role": "QA",
                            "instructions": "Run tests",
                        },
                    ],
                    "edges": [
                        {"source": "api", "target": "verify"},
                        {"source": "ui", "target": "verify"},
                    ],
                },
            },
        ).get_json()
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={"workspacePath": str(tmp_path)},
        ).get_json()
        started = client.post(
            f"/api/multi-agents/tasks/{task['id']}/start", headers=headers
        ).get_json()
        roots = [node for node in started["nodes"] if node["status"] == "ready"]
        assert {node["key"] for node in roots} == {"api", "ui"}
        verify = next(node for node in started["nodes"] if node["key"] == "verify")
        assert verify["status"] == "pending"

        for node in roots:
            assert (
                client.post(
                    f"/api/multi-agents/nodes/{node['id']}/start", headers=headers
                ).status_code
                == 200
            )
            if node["key"] == "api":
                unavailable = client.post(
                    f"/api/multi-agents/nodes/{node['id']}/messages",
                    headers=headers,
                    json={"toNodeId": verify["id"], "content": "Premature handoff"},
                )
                assert unavailable.status_code == 409
                assert unavailable.get_json()["error"]["code"] == "target_agent_not_started"
            current = client.post(
                f"/api/multi-agents/nodes/{node['id']}/complete",
                headers=headers,
                json={"output": {"content": f"{node['name']} done"}},
            ).get_json()

        verify = next(node for node in current["nodes"] if node["key"] == "verify")
        assert verify["status"] == "ready"
        client.post(f"/api/multi-agents/nodes/{verify['id']}/start", headers=headers)
        completed = client.post(
            f"/api/multi-agents/nodes/{verify['id']}/complete",
            headers=headers,
            json={"output": {"content": "All checks passed"}},
        ).get_json()
        assert completed["status"] == "completed"

        api_node = next(node for node in completed["nodes"] if node["key"] == "api")
        revision = client.post(
            f"/api/multi-agents/nodes/{verify['id']}/messages",
            headers=headers,
            json={
                "toNodeId": api_node["id"],
                "content": "Please revise the API result",
                "intent": "revision_request",
                "expectsReply": True,
            },
        )
        assert revision.status_code == 201
        assert revision.get_json()["sourceStatus"] == "paused"
        assert revision.get_json()["targetStatus"] == "running"
        duplicate_revision = client.post(
            f"/api/multi-agents/nodes/{verify['id']}/messages",
            headers=headers,
            json={
                "toNodeId": api_node["id"],
                "content": "Please revise the API result again",
                "intent": "revision_request",
                "expectsReply": True,
            },
        )
        assert duplicate_revision.status_code == 409
        assert duplicate_revision.get_json()["error"]["code"] == "agent_request_already_pending"

        reply = client.post(
            f"/api/multi-agents/nodes/{api_node['id']}/messages",
            headers=headers,
            json={
                "toNodeId": verify["id"],
                "content": "The revised API result is ready",
                "intent": "revision_result",
            },
        )
        assert reply.status_code == 201
        assert reply.get_json()["targetStatus"] == "running"
        revised = client.post(
            f"/api/multi-agents/nodes/{api_node['id']}/complete",
            headers=headers,
            json={"output": {"content": "API revised"}},
        ).get_json()
        verify = next(node for node in revised["nodes"] if node["key"] == "verify")
        assert verify["status"] == "running"
        assert revised["status"] == "running"

        inform = client.post(
            f"/api/multi-agents/nodes/{verify['id']}/messages",
            headers=headers,
            json={
                "toNodeId": api_node["id"],
                "content": "For your information",
                "intent": "inform",
            },
        )
        assert inform.status_code == 201
        assert inform.get_json()["targetStatus"] == "completed"

        blocked_delete = client.delete(f"/api/multi-agents/tasks/{task['id']}", headers=headers)
        assert blocked_delete.status_code == 409
        assert blocked_delete.get_json()["error"]["code"] == "workflow_running_cannot_delete"
        assert (
            client.post(f"/api/multi-agents/tasks/{task['id']}/stop", headers=headers).status_code
            == 200
        )
        assert (
            client.delete(f"/api/multi-agents/tasks/{task['id']}", headers=headers).status_code
            == 204
        )


def test_rerun_reuses_task_and_resets_execution(tmp_path):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    with app.test_client() as client:
        token = client.post(
            "/api/auth/register",
            json={
                "email": "rerun@example.com",
                "displayName": "Rerun",
                "password": "secret123",
            },
        ).get_json()["tokens"]["accessToken"]
        headers = {"Authorization": f"Bearer {token}"}
        agent = client.post(
            "/api/multi-agents",
            headers=headers,
            json={
                "name": "Reusable",
                "description": "Run twice",
                "division": "One worker",
                "flow": {
                    "title": "Reusable",
                    "nodes": [
                        {
                            "key": "worker",
                            "name": "Worker",
                            "role": "Worker",
                            "instructions": "Work",
                        },
                        {
                            "key": "reviewer",
                            "name": "Reviewer",
                            "role": "Reviewer",
                            "instructions": "Review",
                        },
                    ],
                    "edges": [{"source": "worker", "target": "reviewer"}],
                },
            },
        ).get_json()
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={"workspacePath": str(tmp_path), "request": "Do work"},
        ).get_json()
        started = client.post(
            f"/api/multi-agents/tasks/{task['id']}/start", headers=headers
        ).get_json()
        worker = next(node for node in started["nodes"] if node["key"] == "worker")
        client.post(f"/api/multi-agents/nodes/{worker['id']}/start", headers=headers)
        completed = client.post(
            f"/api/multi-agents/nodes/{worker['id']}/complete",
            headers=headers,
            json={"output": {"content": "done"}},
        ).get_json()
        reviewer = next(node for node in completed["nodes"] if node["key"] == "reviewer")
        client.post(f"/api/multi-agents/nodes/{reviewer['id']}/start", headers=headers)
        completed = client.post(
            f"/api/multi-agents/nodes/{reviewer['id']}/complete",
            headers=headers,
            json={"output": {"content": "reviewed"}},
        ).get_json()
        assert completed["status"] == "completed"

        rerun = client.post(
            f"/api/multi-agents/tasks/{task['id']}/start", headers=headers
        ).get_json()
        rerun_worker = next(node for node in rerun["nodes"] if node["key"] == "worker")
        assert rerun["id"] == task["id"]
        assert rerun["status"] == "running"
        assert rerun_worker["id"] == worker["id"]
        assert rerun_worker["status"] == "ready"
        assert rerun_worker["finalOutput"] is None
        listed = client.get("/api/multi-agents", headers=headers).get_json()
        assert len(listed[0]["tasks"]) == 1
