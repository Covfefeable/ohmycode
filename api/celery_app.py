import os

from dotenv import load_dotenv

load_dotenv()

from app import create_app  # noqa: E402

flask_app = create_app(os.getenv("APP_ENV", "development"))
celery = flask_app.extensions["celery"]
