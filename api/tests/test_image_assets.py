import base64
import copy
import json
from io import BytesIO
from uuid import uuid4

import pytest
from PIL import Image

from app import create_app
from app.extensions import db
from app.models import AgentRun, Conversation, Message, Project, User
from app.services import image_assets
from app.services.agent.request_snapshots import snapshot_body
from app.services.agent.runs import cancel_run
from app.services.agent.tool_history import image_tool_content
from app.services.errors import ServiceError


@pytest.fixture
def objects(monkeypatch):
    stored = {}
    monkeypatch.setattr(
        image_assets, "put_object", lambda key, content, mime: stored.update({key: (content, mime)})
    )

    def read(key):
        if key not in stored:
            raise ServiceError("object_not_found", 404)
        return stored[key]

    monkeypatch.setattr(image_assets, "get_object", read)
    return stored


def picture():
    stream = BytesIO()
    Image.new("RGB", (16, 12), "green").save(stream, format="PNG")
    return stream.getvalue()


def test_storage_references_and_model_hydration_do_not_mutate_history(objects):
    user = uuid4()
    encoded = base64.b64encode(picture()).decode()
    original = {"contentKind": "image", "dataUrl": f"data:image/png;base64,{encoded}"}
    before = copy.deepcopy(original)
    stored = image_assets.store_images(user, original)
    assert original == before
    assert "dataUrl" not in stored
    assert len(objects) == 1
    assert next(iter(objects.values())) == (picture(), "image/png")
    assert stored["width"] == 16
    parts = image_tool_content(stored)
    assert "base64" not in json.dumps(parts)
    hydrated = image_assets.hydrate_images(parts)
    assert hydrated[-1]["image_url"]["url"] == original["dataUrl"]
    assert "base64" not in json.dumps(stored)
    assert encoded not in json.dumps(snapshot_body(hydrated))


def test_mcp_images_and_resources_store_bytes_in_objects(objects):
    encoded = base64.b64encode(picture()).decode()
    stored = image_assets.store_images(
        uuid4(),
        {
            "content": [
                {"type": "image", "data": encoded, "mimeType": "image/png"},
                {"type": "resource", "resource": {"mimeType": "image/png", "blob": encoded}},
            ]
        },
    )
    assert encoded not in json.dumps(stored)
    assert len(objects) == 1
    assert image_tool_content(stored)[0]["image_url"]["url"].startswith("ohmycode-image://")


def test_references_are_account_scoped_and_invalid_images_are_rejected(objects):
    asset = image_assets.save_image(uuid4(), picture())
    for value in [asset, {"type": "image_url", "image_url": {"url": asset["imageRef"]}}]:
        with pytest.raises(ServiceError, match="invalid_image_reference"):
            image_assets.store_images(uuid4(), value)
    with pytest.raises(ServiceError, match="invalid_image"):
        image_assets.save_image(uuid4(), b"not an image")
    with pytest.raises(ServiceError, match="invalid_image_size"):
        image_assets.save_image(uuid4(), b"x" * (image_assets.MAX_IMAGE_BYTES + 1))


def test_upload_and_preview_require_authentication_and_owner(objects):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
    client = app.test_client()
    assert client.post("/api/images", data=picture()).status_code == 401

    def register(email):
        auth = client.post(
            "/api/auth/register",
            json={"email": email, "displayName": "Image", "password": "secret123"},
        ).get_json()
        return {"Authorization": f"Bearer {auth['tokens']['accessToken']}"}

    owner = register("images@example.com")
    other = register("other-images@example.com")
    response = client.post(
        "/api/images", headers=owner, data=picture(), content_type="application/octet-stream"
    )
    assert response.status_code == 200
    digest = response.json["imageRef"].rsplit("/", 1)[1]
    preview = client.get(f"/api/images/{digest}", headers=owner)
    assert preview.data == picture()
    assert preview.mimetype == "image/png"
    assert client.get(f"/api/images/{digest}", headers=other).status_code == 404
    assert client.get(f"/api/images/{digest}").status_code == 401


def test_cancel_persists_references_not_pixels(objects):
    app = create_app("testing")
    with app.app_context():
        db.create_all()
        user = User(
            email="cancel-images@example.com", display_name="Images", password_hash="unused"
        )
        db.session.add(user)
        db.session.flush()
        project = Project(
            user_id=user.id,
            name="Images",
            path="/workspace",
            device_id="desktop",
            device_name="Desktop",
        )
        db.session.add(project)
        db.session.flush()
        conversation = Conversation(project_id=project.id, title="Images")
        db.session.add(conversation)
        db.session.flush()
        run = AgentRun(conversation_id=conversation.id, status="running")
        db.session.add(run)
        db.session.commit()
        encoded = base64.b64encode(picture()).decode()
        cancel_run(
            user.id,
            run.id,
            {
                "content": "Partial output",
                "activity": [
                    {
                        "result": {
                            "contentKind": "image",
                            "dataUrl": f"data:image/png;base64,{encoded}",
                        }
                    }
                ],
            },
        )
        message = db.session.scalar(db.select(Message).where(Message.agent_run_id == run.id))
        assert "base64" not in json.dumps(message.activity)
        assert message.activity[0]["result"]["imageRef"].startswith("ohmycode-image://")
        assert run.status == "cancelled"
        assert len(objects) == 1
