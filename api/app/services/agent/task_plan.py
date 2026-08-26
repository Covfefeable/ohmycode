import json

from ...models import AgentRun

TASK_STATUSES = {"pending", "in_progress", "completed"}
MAX_TASKS = 20


def normalize_task_plan(value: object) -> tuple[list[dict] | None, str | None]:
    if not isinstance(value, dict) or not isinstance(value.get("tasks"), list):
        return None, "invalid_task_plan"
    source = value["tasks"]
    if len(source) > MAX_TASKS:
        return None, "too_many_tasks"
    tasks: list[dict] = []
    identifiers: set[str] = set()
    active_count = 0
    for item in source:
        if not isinstance(item, dict):
            return None, "invalid_task_plan"
        identifier = str(item.get("id") or "").strip()
        content = str(item.get("content") or "").strip()
        status = str(item.get("status") or "")
        if not identifier or len(identifier) > 80 or identifier in identifiers:
            return None, "invalid_task_id"
        if not content or len(content) > 300 or status not in TASK_STATUSES:
            return None, "invalid_task_plan"
        identifiers.add(identifier)
        active_count += status == "in_progress"
        tasks.append({"id": identifier, "content": content, "status": status})
    if active_count > 1:
        return None, "multiple_active_tasks"
    return tasks, None


def latest_task_plan(run: AgentRun) -> list[dict]:
    event = next(
        (item for item in reversed(run.events) if item.event_type == "task.plan.updated"), None
    )
    return list(event.payload.get("tasks", [])) if event else []


def active_task_id(tasks: list[dict]) -> str | None:
    return next(
        (str(item["id"]) for item in tasks if item.get("status") == "in_progress"), None
    )


def task_plan_context(run: AgentRun) -> list[dict[str, str]]:
    tasks = latest_task_plan(run)
    if not tasks:
        return []
    return [
        {
            "role": "system",
            "content": (
                "Current task checklist (authoritative latest snapshot):\n"
                + json.dumps(tasks, ensure_ascii=False)
            ),
        }
    ]
