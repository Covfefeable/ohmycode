import json
from uuid import UUID

from ..errors import ServiceError
from .context import estimate_tokens
from .runs import get_owned_run

DEFAULT_PAGE_TOKENS = 2000
MAX_PAGE_TOKENS = 3000
MAX_SEARCH_MATCHES = 8
SEARCH_CONTEXT_CHARACTERS = 128


def render_tool_result(result: object) -> str:
    if isinstance(result, dict):
        content = result.get("content")
        if isinstance(content, list):
            text_parts = [
                str(item.get("text"))
                for item in content
                if isinstance(item, dict)
                and item.get("type") == "text"
                and isinstance(item.get("text"), str)
            ]
            if text_parts:
                return "\n\n".join(text_parts)
        if isinstance(result.get("output"), str):
            return result["output"]
    return json.dumps(result, ensure_ascii=False)


def _result_for_call(user_id: UUID, run_id: UUID, call_id: str) -> object:
    run = get_owned_run(user_id, run_id)
    for event in reversed(run.events):
        if event.event_type != "tool.output":
            continue
        for item in event.payload.get("results", []):
            if str(item.get("callId") or "") == call_id:
                return item.get("result")
    raise ServiceError("tool_result_not_found", 404)


def _bounded_tokens(value: object) -> int:
    try:
        requested = int(value)
    except (TypeError, ValueError):
        return DEFAULT_PAGE_TOKENS
    return max(128, min(requested, MAX_PAGE_TOKENS))


def slice_to_token_budget(content: str, start: int, token_budget: int) -> tuple[str, int]:
    start = max(0, min(start, len(content)))
    if start == len(content):
        return "", start
    low, high = start + 1, len(content)
    best = start
    while low <= high:
        end = (low + high) // 2
        if estimate_tokens(content[start:end]) <= token_budget:
            best = end
            low = end + 1
        else:
            high = end - 1
    return content[start:best], best


def read_tool_result(
    user_id: UUID,
    run_id: UUID,
    call_id: str,
    cursor: object = 0,
    max_tokens: object = DEFAULT_PAGE_TOKENS,
) -> dict:
    result = _result_for_call(user_id, run_id, call_id)
    content = render_tool_result(result)
    try:
        start = int(cursor)
    except (TypeError, ValueError):
        start = 0
    start = max(0, min(start, len(content)))
    page, next_cursor = slice_to_token_budget(content, start, _bounded_tokens(max_tokens))
    return {
        "callId": call_id,
        "cursor": start,
        "nextCursor": next_cursor if next_cursor < len(content) else None,
        "totalCharacters": len(content),
        "content": page,
        "complete": next_cursor >= len(content),
    }


def search_tool_result(
    user_id: UUID,
    run_id: UUID,
    call_id: str,
    query: str,
    max_matches: object = 5,
) -> dict:
    content = render_tool_result(_result_for_call(user_id, run_id, call_id))
    query = query.strip()
    if not query:
        return {"callId": call_id, "query": query, "matches": []}
    try:
        limit = int(max_matches)
    except (TypeError, ValueError):
        limit = 5
    limit = max(1, min(limit, MAX_SEARCH_MATCHES))
    folded_content = content.casefold()
    folded_query = query.casefold()
    matches = []
    offset = 0
    while len(matches) < limit:
        index = folded_content.find(folded_query, offset)
        if index < 0:
            break
        start = max(0, index - SEARCH_CONTEXT_CHARACTERS)
        end = min(len(content), index + len(query) + SEARCH_CONTEXT_CHARACTERS)
        matches.append({"start": start, "end": end, "content": content[start:end]})
        offset = max(index + len(folded_query), end)
    return {
        "callId": call_id,
        "query": query,
        "totalCharacters": len(content),
        "matches": matches,
    }
