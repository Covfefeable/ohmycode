from celery import shared_task

from ..services.settings.speech_samples import cleanup_samples


@shared_task(name="app.tasks.speech_samples.cleanup_samples")
def cleanup_speech_samples_task():
    return cleanup_samples()
