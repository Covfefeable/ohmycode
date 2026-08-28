from uuid import UUID

from celery import shared_task

from ..services.agent.turn_summaries import summarize_agent_run


@shared_task(
    bind=True,
    name="app.tasks.turn_summary.summarize_agent_run",
    max_retries=3,
)
def summarize_agent_run_task(self, run_id: str):
    try:
        return summarize_agent_run(UUID(run_id))
    except Exception as error:
        raise self.retry(exc=error, countdown=min(120, 2 ** (self.request.retries + 1) * 5))
