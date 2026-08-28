from datetime import UTC, datetime
from uuid import UUID

from ...extensions import db
from ...models import AgentEvent, AgentRun, Conversation, Message, ModelConfiguration, Project
from ..errors import ServiceError
from .config import CANCEL_SUMMARY_TOKEN_BUDGET
from .prompts import STOPPED_RUN_CONTEXT


def start_run(
    conversation_id: UUID,
    model: ModelConfiguration,
    turn_id: UUID | None = None,
    tool_snapshot: list[dict] | None = None,
) -> AgentRun:
    values = {
        "conversation_id": conversation_id,
        "model_configuration_id": model.id,
        "tool_snapshot": tool_snapshot or [],
    }
    if turn_id is not None:
        values["id"] = turn_id
    run = AgentRun(**values)
    db.session.add(run)
    db.session.flush()
    append_event(run, "run.started", {"modelId": str(model.id)})
    db.session.commit()
    return run


def append_event(run: AgentRun, event_type: str, payload: dict | None = None) -> AgentEvent:
    run.last_event_sequence += 1
    event = AgentEvent(
        run=run, sequence=run.last_event_sequence, event_type=event_type, payload=payload or {}
    )
    db.session.add(event)
    return event


def build_run_activity(
    run: AgentRun, final_reasoning: str = "", *, include_run_boundary: bool = False
) -> list[dict]:
    activity: list[dict] = []
    tools: dict[str, dict] = {}
    latest_plan: list[dict] = []
    current_task_id: str | None = None
    for event in run.events:
        if event.event_type == "run.started" and include_run_boundary:
            activity.append(
                {
                    "id": f"run-{run.id}",
                    "type": "run",
                    "status": "running" if run.status == "running" else "completed",
                }
            )
        elif event.event_type == "task.plan.updated":
            latest_plan = list(event.payload.get("tasks", []))
            current_task_id = next(
                (
                    str(item["id"])
                    for item in latest_plan
                    if item.get("status") == "in_progress"
                ),
                None,
            )
        elif event.event_type == "reasoning.completed" and event.payload.get("content"):
            step = {
                    "id": f"reasoning-{run.id}-{event.sequence}",
                    "type": "reasoning",
                    "content": event.payload["content"],
                    "status": "completed",
                }
            if current_task_id:
                step["taskId"] = current_task_id
            activity.append(step)
        elif event.event_type == "message.progress" and event.payload.get("content"):
            step = {
                    "id": f"message-{run.id}-{event.sequence}",
                    "type": "message",
                    "content": event.payload["content"],
                    "status": "completed",
                }
            if current_task_id:
                step["taskId"] = current_task_id
            activity.append(step)
        elif event.event_type == "tool.requested":
            assignments = event.payload.get("taskAssignments", {})
            for call in event.payload.get("toolCalls", []):
                if call["function"]["name"] == "update_tasks":
                    continue
                step = {
                    "id": call["id"],
                    "type": "tool",
                    "tool": call["function"]["name"],
                    "input": call["function"].get("arguments", "{}"),
                    "status": "running",
                }
                if task_id := assignments.get(call["id"]):
                    step["taskId"] = task_id
                tools[call["id"]] = step
                activity.append(step)
        elif event.event_type == "tool.output":
            for item in event.payload.get("results", []):
                if step := tools.get(item.get("callId")):
                    step["result"] = item.get("result")
                    step["status"] = "completed"
    if latest_plan:
        activity.insert(
            0,
            {"id": f"task-plan-{run.id}", "type": "task_plan", "tasks": latest_plan},
        )
    if final_reasoning:
        activity.append(
            {
                "id": f"reasoning-final-{run.id}-{run.last_event_sequence}",
                "type": "reasoning",
                "content": final_reasoning,
                "status": "completed",
            }
        )
    return activity


def get_owned_run(user_id: UUID, run_id: UUID) -> AgentRun:
    run = db.session.scalar(
        db.select(AgentRun)
        .join(Conversation, AgentRun.conversation_id == Conversation.id)
        .join(Project, Conversation.project_id == Project.id)
        .where(AgentRun.id == run_id, Project.user_id == user_id)
    )
    if not run:
        raise ServiceError("not_found", 404)
    return run


def complete_run(run: AgentRun, message_id: UUID) -> None:
    append_event(run, "message.completed", {"messageId": str(message_id)})
    append_event(run, "run.completed")
    run.status = "completed"
    run.completed_at = datetime.now(UTC)
    db.session.commit()


def fail_run(run: AgentRun, error_code: str) -> None:
    append_event(run, "run.failed", {"errorCode": error_code})
    run.status = "failed"
    run.error_code = error_code[:1000]
    run.completed_at = datetime.now(UTC)
    db.session.commit()


def cancel_run(user_id: UUID, run_id: UUID, partial_message: object = None) -> None:
    run = get_owned_run(user_id, run_id)
    if run.status in {"completed", "failed", "cancelled"}:
        return
    append_event(run, "run.cancelled", {"reason": "user_requested"})
    run.status = "cancelled"
    run.completed_at = datetime.now(UTC)
    if isinstance(partial_message, dict) and not db.session.scalar(
        db.select(Message.id).where(Message.agent_run_id == run.id)
    ):
        content = str(partial_message.get("content") or "").strip()
        activity = partial_message.get("activity")
        db.session.add(
            Message(
                conversation_id=run.conversation_id,
                agent_run_id=run.id,
                role="assistant",
                content=content,
                activity=activity if isinstance(activity, list) else None,
            )
        )
    db.session.commit()


def _compact_value(value: object, maximum: int = 360) -> str:
    rendered = str(value or "").strip().replace("\x00", "")
    if len(rendered) <= maximum:
        return rendered
    head = maximum * 2 // 3
    tail = maximum - head
    return f"{rendered[:head]} … {rendered[-tail:]}"


def _cancelled_run_summary(run: AgentRun, message: Message | None) -> str:
    steps = build_run_activity(run)
    known_ids = {str(step.get("id")) for step in steps}
    if message and isinstance(message.activity, list):
        steps.extend(
            step
            for step in message.activity
            if isinstance(step, dict) and str(step.get("id")) not in known_ids
        )
    lines = [
        STOPPED_RUN_CONTEXT,
        "Use the summary below to avoid repeating completed work unless the user asks.",
        "Most recent interrupted run reached:",
    ]
    for step in steps:
        if step.get("type") == "message" and step.get("content"):
            lines.append(f"- Visible progress: {_compact_value(step['content'])}")
        elif step.get("type") == "tool":
            detail = f"- Tool {step.get('tool') or 'unknown'}"
            if step.get("input"):
                detail += f" input={_compact_value(step['input'], 240)}"
            detail += f" status={step.get('status') or 'unknown'}"
            if step.get("result") is not None:
                detail += f" result={_compact_value(step['result'], 360)}"
            lines.append(detail)
    if message and message.content.strip():
        lines.append(f"- Partial response: {_compact_value(message.content, 500)}")
    summary = "\n".join(lines)
    maximum_chars = CANCEL_SUMMARY_TOKEN_BUDGET * 2
    return _compact_value(summary, maximum_chars)


def cancelled_run_context(conversation_id: UUID, current_run_id: UUID) -> list[dict[str, str]]:
    cancelled_run = db.session.scalar(
        db.select(AgentRun)
        .where(
            AgentRun.conversation_id == conversation_id,
            AgentRun.id != current_run_id,
            AgentRun.status == "cancelled",
        )
        .order_by(AgentRun.completed_at.desc(), AgentRun.started_at.desc())
        .limit(1)
    )
    if not cancelled_run:
        return []
    message = db.session.scalar(
        db.select(Message)
        .where(Message.agent_run_id == cancelled_run.id)
        .order_by(Message.created_at.desc())
        .limit(1)
    )
    return [
        {
            "role": "system",
            "content": _cancelled_run_summary(cancelled_run, message),
        }
    ]
