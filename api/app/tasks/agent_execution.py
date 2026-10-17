from uuid import UUID

from celery import shared_task

from ..services.agent.execution_worker import execute_execution, reconcile_executions


@shared_task(name="app.tasks.agent_execution.execute_model_request")
def execute_model_request(execution_id: str):
    execute_execution(UUID(execution_id))


@shared_task(name="app.tasks.agent_execution.reconcile_model_requests")
def reconcile_model_requests():
    reconcile_executions()
