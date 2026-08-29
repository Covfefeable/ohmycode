from celery import shared_task

from ..services.agent.event_retention import cleanup_expired_agent_events


@shared_task(name="app.tasks.event_retention.cleanup_expired_agent_events")
def cleanup_expired_agent_events_task():
    return cleanup_expired_agent_events()
