import json
from collections.abc import Callable, Generator

from flask import current_app

from ...extensions import db
from ...models import AgentRun, Conversation, Message
from ..errors import ServiceError
from .preparation import CompletionPreparation
from .provider_errors import provider_error_code
from .provider_stream import PreparedCompletion, provider_payloads
from .runs import (
    append_event,
    build_run_activity,
    complete_run,
    fail_run,
)
from .steering import pending_inputs
from .task_plan import active_task_id, latest_task_plan, normalize_task_plan


def stream_completion(
    prepared: PreparedCompletion | CompletionPreparation,
    *,
    is_active: Callable[[], bool] | None = None,
):
    if is_active is not None and not is_active():
        return
    if isinstance(prepared, Generator):
        try:
            prepared = yield from prepared
        except ServiceError as error:
            yield {"type": "run.failed", "errorCode": error.code}
            return
    if is_active is not None and not is_active():
        return
    answer = ""
    reasoning = ""
    tool_calls: dict[int, dict] = {}
    input_tokens_total = 0
    output_tokens_total = 0
    has_input_usage = False
    has_output_usage = False
    reasoning_started = False
    message_started = False
    run = db.session.get(AgentRun, prepared.run_id)
    try:
        for payload in provider_payloads(prepared):
            if is_active is not None and not is_active():
                return
            usage = payload.get("usage") or {}
            input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
            output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
            if input_tokens is not None:
                input_tokens_total = int(input_tokens)
                has_input_usage = True
            if output_tokens is not None:
                output_tokens_total = int(output_tokens)
                has_output_usage = True
            choice = (payload.get("choices") or [{}])[0]
            delta = choice.get("delta") or {}
            for tool_delta in delta.get("tool_calls") or []:
                index = int(tool_delta.get("index", 0))
                current = tool_calls.setdefault(
                    index,
                    {
                        "id": "",
                        "type": "function",
                        "function": {"name": "", "arguments": ""},
                    },
                )
                if tool_delta.get("id"):
                    current["id"] = tool_delta["id"]
                function_delta = tool_delta.get("function") or {}
                current["function"]["name"] += function_delta.get("name") or ""
                current["function"]["arguments"] += function_delta.get("arguments") or ""
            reasoning_chunk = delta.get("reasoning_content") or delta.get("reasoning")
            if reasoning_chunk:
                if not reasoning_started:
                    reasoning_started = True
                    yield {
                        "type": "reasoning.started",
                        "stepId": f"reasoning-{run.last_event_sequence + 1}",
                    }
                reasoning += reasoning_chunk
                yield {"type": "reasoning.delta", "content": reasoning_chunk}
            chunk = delta.get("content") or choice.get("text")
            if not chunk and choice.get("message"):
                chunk = choice["message"].get("content")
            if chunk:
                if not message_started:
                    message_started = True
                    yield {"type": "message.started"}
                answer += chunk
                yield {"type": "message.delta", "content": chunk}
        run = db.session.scalar(
            db.select(AgentRun)
            .where(AgentRun.id == prepared.run_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if is_active is not None and not is_active():
            return
        if run.status != "running":
            return
        if has_input_usage:
            run.input_tokens = (run.input_tokens or 0) + input_tokens_total
        if has_output_usage:
            run.output_tokens = (run.output_tokens or 0) + output_tokens_total
        if has_input_usage:
            context_usage = {
                "usedTokens": input_tokens_total,
                "contextLength": prepared.context_length,
                "source": "provider",
                "estimatedTokens": prepared.estimated_input_tokens,
                "model": prepared.payload["model"],
            }
            append_event(run, "context.usage", context_usage)
            yield {"type": "context.usage", **context_usage}
        if tool_calls:
            calls = [tool_calls[index] for index in sorted(tool_calls)]
            conversation = db.session.get(Conversation, prepared.conversation_id)
            allowed_tool_names = {
                str(tool.get("function", {}).get("name") or "")
                for tool in prepared.payload.get("tools", [])
            }
            if not conversation or any(
                call["function"]["name"] not in allowed_tool_names for call in calls
            ):
                fail_run(run, "unsupported_tool")
                yield {"type": "run.failed", "errorCode": "unsupported_tool"}
                return
            requests = []
            current_tasks = latest_task_plan(run)
            for call in calls:
                if call["function"]["name"] != "update_tasks":
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
            if reasoning:
                append_event(run, "reasoning.completed", {"content": reasoning})
            if answer:
                append_event(run, "message.progress", {"content": answer})
            append_event(
                run,
                "tool.requested",
                {
                    "toolCalls": calls,
                    "content": answer or None,
                    "taskAssignments": {
                        item["callId"]: item["taskId"] for item in requests if item.get("taskId")
                    },
                },
            )
            run.status = "waiting_tool"
            db.session.flush()
            for request in requests:
                yield {"type": "tool.requested", "runId": str(run.id), **request}
        elif answer:
            run = db.session.scalar(
                db.select(AgentRun)
                .where(AgentRun.id == prepared.run_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
            if run.status != "running":
                return
            if pending_inputs(run):
                if reasoning:
                    append_event(run, "reasoning.completed", {"content": reasoning})
                append_event(run, "message.progress", {"content": answer, "continuation": True})
                yield {"type": "run.continue", "runId": str(run.id)}
                return
            prior_reasoning = "\n\n".join(
                event.payload.get("content", "")
                for event in run.events
                if event.event_type == "reasoning.completed"
            )
            full_reasoning = "\n\n".join(part for part in (prior_reasoning, reasoning) if part)
            message = Message(
                conversation_id=prepared.conversation_id,
                agent_run_id=run.id,
                role="assistant",
                content=answer,
                reasoning=full_reasoning or None,
                activity=build_run_activity(run, reasoning) or None,
            )
            db.session.add(message)
            db.session.flush()
            complete_run(run, message.id)
        else:
            fail_run(run, "empty_model_response")
            yield {"type": "run.failed", "errorCode": "empty_model_response"}
    except Exception as error:
        db.session.rollback()
        run = db.session.get(AgentRun, prepared.run_id)
        if run:
            db.session.expire(run)
        error_code = provider_error_code(error)
        if run and run.status == "running":
            fail_run(run, error_code)
        current_app.logger.exception("Agent stream failed for run %s", prepared.run_id)
        # An exception escaping a streaming response makes Werkzeug close the
        # chunked HTTP body without its terminating chunk. Electron/undici then
        # reports an opaque `Invalid EOF state` instead of the actual run error.
        # Always finish the SSE protocol normally and keep the diagnostic in
        # the server log.
        yield {"type": "run.failed", "errorCode": error_code}
        return
