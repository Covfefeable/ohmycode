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
            json={"name": "Workspace Agent", "workspacePath": str(tmp_path)},
        ).get_json()
        task = client.post(
            f"/api/multi-agents/{agent['id']}/tasks",
            headers=headers,
            json={
                "request": "Implement and verify a feature",
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
