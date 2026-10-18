import base64
import copy
from io import BytesIO

import pytest
from PIL import Image

from app.services.agent.image_context import image_tokens, text_only_images
from app.services.agent.tokens import request_tokens


def image_url(size=(1024, 1024), *, compress_level=6, format="PNG"):
    output = BytesIO()
    Image.new("RGB", size, "green").save(output, format=format, compress_level=compress_level)
    data = base64.b64encode(output.getvalue()).decode()
    return {"url": f"data:image/{format.lower()};base64,{data}"}


@pytest.mark.parametrize("format", ["PNG", "JPEG", "WEBP", "GIF", "BMP"])
def test_image_budget_uses_dimensions_not_encoding(format):
    assert image_tokens(image_url(format=format)) == 765


def test_encoding_size_does_not_change_request_budget_or_mutate_messages():
    small = image_url(compress_level=9)
    large = image_url(compress_level=0)
    assert len(large["url"]) > 100 * len(small["url"])
    messages = [{"role": "user", "content": [{"type": "image_url", "image_url": large}]}]
    original = copy.deepcopy(messages)
    budget = request_tokens(messages, [])
    assert budget < 1000
    assert messages == original
    messages[0]["content"][0]["image_url"] = small
    assert request_tokens(messages, []) == budget


def test_multiple_images_detail_and_unknown_dimensions():
    image = image_url()
    assert image_tokens({**image, "detail": "low"}) == 85
    assert image_tokens(image_url((256, 256))) < image_tokens(image)
    assert image_tokens({"url": "https://example.com/photo.jpg"}) == 1445
    assert image_tokens({"url": "data:image/png;base64,invalid"}) == 1445
    parts = [{"type": "text", "text": "Describe both images"}]
    base = request_tokens([{"role": "user", "content": parts}], [])
    parts.extend([{"type": "image_url", "image_url": image}] * 2)
    assert request_tokens([{"role": "user", "content": parts}], []) == base + 2 * 765


def test_history_projection_keeps_image_references_without_changing_stored_data():
    source = {
        "results": [
            {
                "callId": "image-1",
                "result": {
                    "contentKind": "image",
                    "dataUrl": image_url()["url"],
                    "source": "/photos/example.png",
                    "width": 1024,
                    "height": 1024,
                },
            }
        ],
    }
    original = copy.deepcopy(source)
    projected = text_only_images(source)
    assert "dataUrl" not in projected["results"][0]["result"]
    assert projected["results"][0]["result"]["source"] == "/photos/example.png"
    assert source == original
    remote = {"type": "image_url", "image_url": {"url": "https://example.com/photo.jpg"}}
    assert text_only_images(remote)["text"] == "https://example.com/photo.jpg"
