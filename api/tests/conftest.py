import pytest


@pytest.fixture(autouse=True)
def model_worker_dispatch(monkeypatch):
    """Run queued jobs deterministically; lifecycle tests replace this with an explicit queue."""
    from app.services.agent.execution_worker import execute_execution

    monkeypatch.setattr("app.services.agent.executions.dispatch_execution", execute_execution)
