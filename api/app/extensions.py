from celery import Celery, Task
from flask_cors import CORS
from flask_jwt_extended import JWTManager
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


db = SQLAlchemy(model_class=Base)
migrate = Migrate()
cors = CORS()
jwt = JWTManager()
celery = Celery("ohmycode")


def init_celery(app):
    class FlaskTask(Task):
        def __call__(self, *args, **kwargs):
            with app.app_context():
                return self.run(*args, **kwargs)

    celery.Task = FlaskTask
    celery.conf.update(
        broker_url=app.config["CELERY_BROKER_URL"],
        result_backend=app.config["CELERY_RESULT_BACKEND"],
        task_ignore_result=True,
        task_publish_retry=False,
        task_serializer="json",
        accept_content=["json"],
        timezone="Asia/Shanghai",
        beat_schedule={
            "reconcile-capability-embeddings": {
                "task": "app.tasks.capability_embedding.reconcile_capability_embeddings",
                "schedule": 300.0,
            }
        },
        imports=("app.tasks.capability_embedding", "app.tasks.turn_summary"),
    )
    celery.set_default()
    app.extensions["celery"] = celery
    return celery
