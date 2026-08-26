import os

from app import create_app

flask_app = create_app(os.getenv("APP_ENV", "development"))
celery = flask_app.extensions["celery"]
