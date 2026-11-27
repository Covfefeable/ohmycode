import json
import re
from uuid import UUID

import httpx

from ..errors import ServiceError
from ..model_completion import completion_text, post_completion
from ..settings import get_model_configuration

PLANNER_PROMPT = """Design a reusable AI collaboration team. Return JSON only.
Create exactly one host and 1-8 focused participant roles. The host receives the user's run brief,
controls the conversation, delegates one speaker at a time, resolves stalls, and ends the task.
Participants collaborate through a shared group chat. Do not create workflow, start, end, routing,
checkpoint, or project-management filler roles.
Schema: {"title": string, "members": [{"key": string, "name": string, "role": string,
"instructions": string, "isHost": boolean}]}.
Keys must be unique lowercase snake_case. Exactly one member must have isHost=true."""
PLANNER_ATTEMPTS = 3


def _json_content(value: str) -> dict:
    cleaned = value.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise ServiceError("invalid_collaboration_team", 502) from error
    if not isinstance(result, dict):
        raise ServiceError("invalid_collaboration_team", 502)
    return result


def generate_plan(user_id: UUID, request: str, model_id: str | None = None) -> dict:
    model = get_model_configuration(user_id, model_id)
    if not model:
        raise ServiceError("model_not_configured", 422)
    messages = [
        {"role": "system", "content": PLANNER_PROMPT},
        {"role": "user", "content": f"Collaboration brief:\n{request}"},
    ]
    use_json_mode = True
    for attempt in range(PLANNER_ATTEMPTS):
        content = ""
        try:
            response = post_completion(
                model,
                messages,
                timeout=120,
                response_format={"type": "json_object"} if use_json_mode else None,
            )
        except httpx.HTTPStatusError as error:
            if use_json_mode and error.response.status_code in {400, 404, 422}:
                use_json_mode = False
                continue
            raise ServiceError("collaboration_planning_failed", 502) from error
        except httpx.HTTPError as error:
            raise ServiceError("collaboration_planning_failed", 502) from error

        try:
            content = completion_text(response.json())
            return validate_plan(_json_content(content))
        except (KeyError, IndexError, TypeError, ValueError, ServiceError) as error:
            if attempt == PLANNER_ATTEMPTS - 1:
                if isinstance(error, ServiceError):
                    raise ServiceError("invalid_collaboration_team", 422) from error
                raise ServiceError("invalid_collaboration_team", 422) from error
            raw_content = content if isinstance(content, str) else "{}"
            messages = [
                *messages,
                {"role": "assistant", "content": raw_content[:12_000]},
                {
                    "role": "user",
                    "content": (
                        "The JSON did not match the required schema. Correct it now. Include "
                        "exactly one host, at least one participant, unique keys, and non-empty "
                        "name, role, and instructions for every member. Return JSON only."
                    ),
                },
            ]
    raise ServiceError("invalid_collaboration_team", 422)


def validate_plan(plan: dict) -> dict:
    raw_members = plan.get("members")
    if not isinstance(raw_members, list) or not 2 <= len(raw_members) <= 10:
        raise ServiceError("invalid_collaboration_team", 422)
    members, keys = [], set()
    for index, item in enumerate(raw_members):
        if not isinstance(item, dict):
            raise ServiceError("invalid_collaboration_team", 422)
        key = re.sub(r"[^a-z0-9_]+", "_", str(item.get("key") or "").lower()).strip("_")
        if not key or key in keys:
            raise ServiceError("invalid_collaboration_team", 422)
        keys.add(key)
        reasoning_effort = item.get("reasoningEffort", "")
        if not isinstance(reasoning_effort, str) or len(reasoning_effort) > 100:
            raise ServiceError("invalid_reasoning_effort", 422)
        member = {
            "key": key,
            "name": str(item.get("name") or "").strip()[:160],
            "role": str(item.get("role") or "").strip()[:500],
            "instructions": str(item.get("instructions") or "").strip(),
            "modelId": str(item.get("modelId") or "").strip() or None,
            "reasoningEffort": reasoning_effort.strip(),
            "isHost": bool(item.get("isHost")),
            "sortOrder": index,
        }
        if not member["name"] or not member["role"] or not member["instructions"]:
            raise ServiceError("invalid_collaboration_team", 422)
        members.append(member)
    if sum(member["isHost"] for member in members) != 1:
        raise ServiceError("collaboration_requires_one_host", 422)
    members.sort(key=lambda item: (not item["isHost"], item["sortOrder"]))
    return {
        "title": str(plan.get("title") or "New collaboration").strip()[:240],
        "members": members,
    }
