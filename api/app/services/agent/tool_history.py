import json
from dataclasses import dataclass
from difflib import unified_diff
from uuid import UUID

from ...models import AgentRun
from .config import RECENT_TOOL_IMAGE_BATCHES, TOOL_RESULT_TOKEN_BUDGET
from .image_context import text_only_images
from .tokens import estimate_tokens
from .tool_results import render_tool_result, slice_to_token_budget


@dataclass(frozen=True)
class ToolBatch:
    sequence: int
    messages: list[dict]


def model_tool_result(result: object, run_id: UUID, call_id: str) -> object:
    """Keep full patch evidence in storage, never in the model-facing diff projection."""
    result = text_only_images(result)
    if not isinstance(result, dict) or result.get("operation") != "apply_patch":
        return result
    changes = []
    for change in result.get("changes", []):
        projected = {"path": change.get("path")}
        if change.get("diffUnavailable"):
            projected["diffUnavailable"] = change["diffUnavailable"]
        else:
            before, after = change.get("original"), change.get("modified")
            projected["action"] = (
                "added" if before is None else "deleted" if after is None else "updated"
            )
            added = removed = 0
            preview = []
            diff_truncated = False
            for index, line in enumerate(
                unified_diff((before or "").splitlines(), (after or "").splitlines(), n=2)
            ):
                if index >= 2 and line.startswith("+"):
                    added += 1
                elif index >= 2 and line.startswith("-"):
                    removed += 1
                if len(preview) < 40:
                    preview.append(line[:240])
                    diff_truncated |= len(line) > 240
                else:
                    diff_truncated = True
            projected.update(
                addedLines=added,
                removedLines=removed,
                diffPreview="\n".join(preview),
                diffTruncated=diff_truncated,
            )
        changes.append(projected)
    return {
        **{key: value for key, value in result.items() if key != "changes"},
        "changes": changes,
        "resultRef": {"runId": str(run_id), "callId": call_id},
        "instructions": (
            "Use read_tool_result or search_tool_result for the complete stored patch evidence."
        ),
    }


def bounded_tool_result_content(run_id: UUID, item: dict, token_budget: int) -> str:
    projected = model_tool_result(item["result"], run_id, item["callId"])
    serialized = json.dumps(projected, ensure_ascii=False)
    if estimate_tokens(serialized) <= token_budget:
        return serialized
    source = render_tool_result(item["result"])
    patch = isinstance(projected, dict) and projected.get("operation") == "apply_patch"
    rendered = serialized if patch else source
    manifest = {
        "contextTruncated": True,
        "sourceMayBeTruncated": (
            isinstance(item["result"], dict) and bool(item["result"].get("truncated"))
        )
        or "[...]" in rendered,
        "resultRef": {"runId": str(run_id), "callId": item["callId"]},
        "totalCharacters": len(source),
        "estimatedTokens": estimate_tokens(source),
        "preview": "",
        "nextCursor": 0,
        "instructions": (
            "Use search_tool_result to find a passage or read_tool_result with nextCursor "
            "to read the complete result without losing the middle."
        ),
    }

    def measure(preview: str) -> int:
        manifest["preview"] = preview
        manifest["nextCursor"] = (
            0 if patch else len(preview) if len(preview) < len(rendered) else None
        )
        return estimate_tokens(json.dumps(manifest, ensure_ascii=False))

    preview, _ = slice_to_token_budget(rendered, 0, token_budget, measure=measure)
    measure(preview)
    return json.dumps(manifest, ensure_ascii=False)


def tool_result_content(run: AgentRun, item: dict, token_budget: int) -> str:
    return bounded_tool_result_content(run.id, item, token_budget)


def image_tool_content(result: object) -> list[dict] | None:
    if not isinstance(result, dict):
        return None
    if isinstance(result.get("content"), list):
        images = [
            {
                "type": "image_url",
                "image_url": {
                    "url": part.get("imageRef") or f"data:{part['mimeType']};base64,{part['data']}"
                },
            }
            for part in result["content"]
            if isinstance(part, dict)
            and part.get("type") == "image"
            and (isinstance(part.get("data"), str) or isinstance(part.get("imageRef"), str))
            and isinstance(part.get("mimeType"), str)
            and part["mimeType"].startswith("image/")
        ]
        return images or None
    if result.get("contentKind") != "image":
        return None
    data_url = result.get("imageRef") or result.get("dataUrl")
    if not isinstance(data_url, str) or not data_url.startswith(
        ("data:image/", "ohmycode-image://")
    ):
        return None
    text_payload = {key: value for key, value in result.items() if key != "dataUrl"}
    image_url = {"url": data_url}
    if result.get("detail") in {"low", "high"}:
        image_url["detail"] = result["detail"]
    return [
        {
            "type": "text",
            "text": f"Image returned by a tool: {json.dumps(text_payload, ensure_ascii=False)}",
        },
        {"type": "image_url", "image_url": image_url},
    ]


def tool_batches(
    run: AgentRun,
    after_sequence: int = 0,
    token_budget: int = TOOL_RESULT_TOKEN_BUDGET,
    *,
    supports_vision: bool,
) -> list[ToolBatch]:
    batches = []
    pending: list[dict] = []
    for event in run.events:
        if event.sequence <= after_sequence:
            continue
        if event.event_type == "tool.requested":
            pending = [
                {
                    "role": "assistant",
                    "content": event.payload.get("content"),
                    "tool_calls": event.payload["toolCalls"],
                }
            ]
        elif event.event_type == "tool.output":
            images = []
            for item in event.payload["results"]:
                result = item["result"]
                if supports_vision and (image_parts := image_tool_content(result)):
                    images.append({"role": "user", "content": image_parts})
                pending.append(
                    {
                        "role": "tool",
                        "tool_call_id": item["callId"],
                        "content": tool_result_content(
                            run, {**item, "result": result}, token_budget
                        ),
                    }
                )
            batches.append(ToolBatch(event.sequence, [*pending, *images]))
            pending = []
        elif event.event_type == "input.received":
            batches.append(
                ToolBatch(
                    event.sequence, [{"role": "user", "content": event.payload["contextContent"]}]
                )
            )
        elif event.event_type == "message.progress" and event.payload.get("continuation"):
            batches.append(
                ToolBatch(
                    event.sequence, [{"role": "assistant", "content": event.payload["content"]}]
                )
            )
    # Budget observations independently of text compaction. Keep every image in
    # the most recent batches together (e.g. a multi-image MCP response).
    image_batches = [
        batch
        for batch in batches
        if any(
            isinstance(message.get("content"), list)
            and any(part.get("type") == "image_url" for part in message["content"])
            for message in batch.messages
        )
    ]
    for batch in image_batches[:-RECENT_TOOL_IMAGE_BATCHES]:
        for message in batch.messages:
            if isinstance(message.get("content"), list):
                message["content"] = text_only_images(message["content"])
    return batches
