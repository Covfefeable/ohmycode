import subprocess
import sys
import textwrap


def test_real_celery_worker_executes_outside_http_context(tmp_path):
    # A fresh process also exercises task registration and FlaskTask's app context.
    script = textwrap.dedent("""\
        import sys
        from celery.contrib.testing.worker import start_worker
        from app import create_app
        from app.config import TestingConfig
        from app.extensions import celery, db
        from app.models import (
            Conversation, Message, ModelConfiguration, ModelExecution, Project, User,
        )
        from app.services.agent import chat
        from app.services.agent.executions import start_execution, subscribe_execution
        from app.services.model_credentials import encrypt_api_key

        TestingConfig.SQLALCHEMY_DATABASE_URI = f"sqlite:///{sys.argv[1]}"
        TestingConfig.CELERY_BROKER_URL = "memory://"
        TestingConfig.CELERY_RESULT_BACKEND = "cache+memory://"
        app = create_app("testing")

        def provider(prepared):
            yield {"choices": [{"delta": {"content": "Background reply"}}]}

        chat.provider_payloads = provider
        with app.app_context():
            db.create_all()
            user = User(email="celery@example.com", display_name="Worker", password_hash="unused")
            db.session.add(user)
            db.session.flush()
            project = Project(
                user_id=user.id, device_id="test", device_name="Test", name="Repo", path="/repo",
            )
            db.session.add(project)
            db.session.flush()
            conversation = Conversation(project_id=project.id)
            model = ModelConfiguration(
                user_id=user.id, name="Test", base_url="https://example.com/v1",
                model="test", api_key_encrypted=encrypt_api_key("test-key"), context_length=4096,
            )
            db.session.add_all([conversation, model])
            db.session.commit()
            execution_id = start_execution(
                user.id, conversation.id, "Hi", str(model.id), tool_snapshot=[],
            )
            assert db.session.get(ModelExecution, execution_id).status == "queued"

        with start_worker(
            celery, pool="solo", concurrency=1, perform_ping_check=False, shutdown_timeout=10,
        ):
            with app.app_context():
                frames = "".join(subscribe_execution(execution_id))
                assert "Background reply" in frames
                assert frames.endswith("data: [DONE]\\n\\n")
                assert db.session.get(ModelExecution, execution_id).status == "completed"
                reply = db.session.scalar(db.select(Message).where(Message.role == "assistant"))
                assert reply.content == "Background reply"
    """)
    result = subprocess.run(
        [sys.executable, "-c", script, str(tmp_path / "celery.db")],
        capture_output=True,
        text=True,
        timeout=40,
    )
    assert result.returncode == 0, result.stdout + result.stderr
