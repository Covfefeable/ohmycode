import json
from dataclasses import dataclass

from ...models import AgentRun
from .config import TOOL_RESULT_TOKEN_BUDGET
from .tokens import estimate_tokens
from .tool_results import render_tool_result, slice_to_token_budget


@dataclass(frozen=True)
class ToolBatch:
    sequence: int
    messages: list[dict]


def tool_result_content(run: AgentRun, item: dict, token_budget: int) -> str:
    serialized = json.dumps(item["result"], ensure_ascii=False)
    if estimate_tokens(serialized) <= token_budget:
        return serialized
    rendered = render_tool_result(item["result"])
    manifest = {
        "contextTruncated": True,
        "sourceMayBeTruncated": (
            isinstance(item["result"], dict) and bool(item["result"].get("truncated"))
        )
        or "[...]" in rendered,
        "resultRef": {"runId": str(run.id), "callId": item["callId"]},
        "totalCharacters": len(rendered),
        "estimatedTokens": estimate_tokens(rendered),
        "preview": "",
        "nextCursor": 0,
        "instructions": (
            "Use search_tool_result to find a passage or read_tool_result with nextCursor "
            "to read the complete result without losing the middle."
        ),
    }

    def measure(preview: str) -> int:
        manifest["preview"] = preview
        manifest["nextCursor"] = len(preview) if len(preview) < len(rendered) else None
        return estimate_tokens(json.dumps(manifest, ensure_ascii=False))

    preview, _ = slice_to_token_budget(rendered, 0, token_budget, measure=measure)
    measure(preview)
    return json.dumps(manifest, ensure_ascii=False)


def image_tool_content(result: object) -> list[dict] | None:
    if not isinstance(result, dict) or result.get("contentKind") != "image":
        return None
    data_url = result.get("dataUrl")
    if not isinstance(data_url, str) or not data_url.startswith("data:image/"):
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
    run: AgentRun, after_sequence: int = 0, token_budget: int = TOOL_RESULT_TOKEN_BUDGET
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
                if image_parts := image_tool_content(result):
                    result = {key: value for key, value in result.items() if key != "dataUrl"}
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
    return batches
