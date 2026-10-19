import pytest

from app import create_app
from app.extensions import db
from app.models import AgentRun, Conversation, ModelConfiguration, Project, SpeechSettings, User
from app.services.agent.preparation import iter_prepare_completion
from app.services.model_credentials import encrypt_api_key
from app.services.settings.speech import VOICE_CHAT_INSTRUCTIONS


@pytest.mark.parametrize(
    "enabled,kind,expected",
    [(True, "chat", True), (False, "chat", False), (True, "multi_agent", False)],
)
def test_voice_chat_prompt_is_scoped_to_enabled_normal_chat(enabled, kind, expected):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(email="voice-chat@example.com", display_name="Voice", password_hash="unused")
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id, device_id="test", device_name="test", name="test", path="/test"
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id, kind=kind)
        model = ModelConfiguration(
            user_id=user.id,
            name="test",
            model="test",
            base_url="https://example.com/v1",
            api_key_encrypted=encrypt_api_key("test-model-key"),
        )
        settings = SpeechSettings(
            user_id=user.id,
            workspace_id="llm-test",
            auto_play=enabled,
            api_key_encrypted=encrypt_api_key("test-speech-key"),
        )
        db.session.add_all([conversation, model, settings])
        db.session.flush()
        run = AgentRun(conversation_id=conversation.id, model_configuration_id=model.id)
        db.session.add(run)
        db.session.commit()
        with pytest.raises(StopIteration) as finished:
            next(iter_prepare_completion(run.id, "", []))
        messages = finished.value.value.payload["messages"]
        assert (
            any(message["content"] == VOICE_CHAT_INSTRUCTIONS for message in messages) is expected
        )
