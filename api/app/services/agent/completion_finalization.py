"""Persist completion outcomes; provider parsing stays in provider_completion."""

import json
from collections.abc import Iterator

from ...extensions import db
from ...models import AgentRun, Conversation, Message
from .provider_completion import CompletionAccumulator
from .provider_stream import PreparedCompletion
from .result_references import protect_result_references
from .runs import append_event, build_run_activity, complete_run, fail_run
from .steering import pending_inputs
from .task_plan import active_task_id, latest_task_plan, normalize_task_plan


def record_completion_usage(
    run: AgentRun, prepared: PreparedCompletion, completion: CompletionAccumulator
) -> Iterator[dict]:
    if completion.input_tokens is not None:
        run.input_tokens = (run.input_tokens or 0) + completion.input_tokens
    if completion.output_tokens is not None:
        run.output_tokens = (run.output_tokens or 0) + completion.output_tokens
    if completion.input_tokens is not None:
        context_usage = {
            "usedTokens": completion.input_tokens,
            "contextLength": prepared.context_length,
            "source": "provider",
            "estimatedTokens": prepared.estimated_input_tokens,
            "model": prepared.payload["model"],
        }
        append_event(run, "context.usage", context_usage)
        yield {"type": "context.usage", **context_usage}


def request_completion_tools(
    run: AgentRun, prepared: PreparedCompletion, completion: CompletionAccumulator
) -> Iterator[dict]:
    calls = [completion.tool_calls[index] for index in sorted(completion.tool_calls)]
    conversation = db.session.get(Conversation, prepared.conversation_id)
    allowed_tool_names = {
        str(tool.get("function", {}).get("name") or "")
        for tool in prepared.payload.get("tools", [])
    }
    if not conversation:
        fail_run(run, "unsupported_tool")
        yield {"type": "run.failed", "errorCode": "unsupported_tool"}
        return
    requests = []
    current_tasks = latest_task_plan(run)
    for call in calls:
        if call["function"]["name"] != "update_tasks" or "update_tasks" not in allowed_tool_names:
            continue
        try:
            raw_plan = json.loads(call["function"]["arguments"] or "{}")
        except json.JSONDecodeError:
            raw_plan = None
        normalized, validation_error = normalize_task_plan(raw_plan)
        if validation_error is None and normalized is not None:
            current_tasks = normalized
            append_event(run, "task.plan.updated", {"tasks": current_tasks})
            yield {"type": "task.plan.updated", "tasks": current_tasks}
    current_task_id = active_task_id(current_tasks)
    for call in calls:
        try:
            arguments = json.loads(call["function"]["arguments"] or "{}")
        except json.JSONDecodeError:
            fail_run(run, "invalid_tool_arguments")
            yield {"type": "run.failed", "errorCode": "invalid_tool_arguments"}
            return
        tool_name = call["function"]["name"]
        request = {"callId": call["id"], "tool": tool_name, "arguments": arguments}
        if tool_name not in allowed_tool_names:
            request["rejection"] = {
                "error": "unsupported_tool",
                "message": (
                    "This tool is not available in the current request. "
                    "Use the tools provided in this request; for additional capabilities, "
                    "search_capabilities and load_capability first if available."
                ),
            }
        if tool_name != "update_tasks" and current_task_id:
            request["taskId"] = current_task_id
        requests.append(request)
    run = db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.id == prepared.run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if run.status != "running":
        return
    if completion.reasoning:
        append_event(run, "reasoning.completed", {"content": completion.reasoning})
    if completion.answer:
        append_event(run, "message.progress", {"content": completion.answer})
    append_event(
        run,
        "tool.requested",
        {
            "toolCalls": calls,
            "content": completion.answer or None,
            "taskAssignments": {
                item["callId"]: item["taskId"] for item in requests if item.get("taskId")
            },
        },
    )
    run.status = "waiting_tool"
    db.session.flush()
    for request in requests:
        yield {"type": "tool.requested", "runId": str(run.id), **request}


def finish_completion_answer(
    run: AgentRun, prepared: PreparedCompletion, completion: CompletionAccumulator
) -> Iterator[dict]:
    run = db.session.scalar(
        db.select(AgentRun)
        .where(AgentRun.id == prepared.run_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if run.status != "running":
        return
    if pending_inputs(run):
        if completion.reasoning:
            append_event(run, "reasoning.completed", {"content": completion.reasoning})
        append_event(run, "message.progress", {"content": completion.answer, "continuation": True})
        yield {"type": "run.continue", "runId": str(run.id)}
        return
    prior_reasoning = "\n\n".join(
        event.payload.get("content", "")
        for event in run.events
        if event.event_type == "reasoning.completed"
    )
    full_reasoning = "\n\n".join(part for part in (prior_reasoning, completion.reasoning) if part)
    protect_result_references(completion.answer, full_reasoning)
    message = Message(
        conversation_id=prepared.conversation_id,
        agent_run_id=run.id,
        role="assistant",
        content=completion.answer,
        reasoning=full_reasoning or None,
        activity=build_run_activity(run, completion.reasoning) or None,
    )
    db.session.add(message)
    db.session.flush()
    complete_run(run, message.id)
