import base64
import copy
import json
import uuid
from io import BytesIO
from types import SimpleNamespace

import pytest
from PIL import Image

from app.services.agent.context_history import _run_context_message
from app.services.agent.image_context import image_tokens, text_only_images
from app.services.agent.tokens import request_tokens
from app.services.agent.tool_history import tool_batches, tool_result_content
from app.services.agent.tool_results import render_tool_result


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


def mcp_result():
    return {
        "content": [
            {"type": "text", "text": "Screenshot captured"},
            {
                "type": "image",
                "data": image_url(compress_level=0)["url"].split(",", 1)[1],
                "mimeType": "image/png",
                "annotations": {"audience": ["assistant"]},
            },
            {"type": "image", "data": "second-image", "mimeType": "image/jpeg"},
        ],
        "structuredContent": {"path": "/screenshots/page.png"},
        "isError": False,
    }


def image_run(result):
    return SimpleNamespace(
        id=uuid.uuid4(),
        summary=None,
        events=[
            SimpleNamespace(
                sequence=1,
                event_type="tool.requested",
                payload={
                    "toolCalls": [
                        {
                            "id": "shot",
                            "type": "function",
                            "function": {
                                "name": "mcp_screenshot",
                                "arguments": "{}",
                            },
                        }
                    ]
                },
            ),
            SimpleNamespace(
                sequence=2,
                event_type="tool.output",
                payload={
                    "results": [{"callId": "shot", "result": result}],
                },
            ),
        ],
    )


@pytest.mark.parametrize("supports_vision", [True, False])
def test_mcp_images_are_visual_parts_only_for_vision_models(supports_vision):
    result = mcp_result()
    original = copy.deepcopy(result)
    run = image_run(result)
    messages = tool_batches(run, supports_vision=supports_vision)[0].messages
    assert [message["role"] for message in messages] == (
        ["assistant", "tool", "user"] if supports_vision else ["assistant", "tool"]
    )
    tool = messages[1]
    assert tool["tool_call_id"] == "shot"
    metadata = json.loads(tool["content"])
    assert metadata["content"][0]["text"] == "Screenshot captured"
    assert metadata["structuredContent"] == result["structuredContent"]
    assert metadata["isError"] is False
    assert "data" not in metadata["content"][1]
    assert metadata["content"][1]["mimeType"] == "image/png"
    assert len(tool["content"]) < 1000
    if supports_vision:
        parts = messages[2]["content"]
        assert len(parts) == 2
        assert (
            parts[0]["image_url"]["url"] == "data:image/png;base64," + result["content"][1]["data"]
        )
        assert parts[1]["image_url"]["url"] == "data:image/jpeg;base64,second-image"
        assert request_tokens(messages, []) < 4000
    assert result == original


def test_mcp_bytes_never_leak_into_history_summary_or_result_pagination():
    result = mcp_result()
    original = copy.deepcopy(result)
    run = image_run(result)
    outputs = [
        json.dumps(text_only_images(run.events[1].payload)),
        _run_context_message(run, protected=True)["content"],
        render_tool_result(result),
        tool_result_content(run, {"callId": "shot", "result": result}, 4000),
        render_tool_result({"content": result["content"][1:]}),
    ]
    for output in outputs:
        assert result["content"][1]["data"] not in output
        assert "second-image" not in output
        assert len(output) < 2000
    assert result == original


def test_mcp_text_only_result_and_error_are_preserved():
    result = {"content": [{"type": "text", "text": "Permission denied"}], "isError": True}
    run = image_run(result)
    messages = tool_batches(run, supports_vision=True)[0].messages
    assert len(messages) == 2
    assert json.loads(messages[1]["content"]) == result
