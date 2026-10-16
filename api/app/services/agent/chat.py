import json
from collections.abc import Generator
from dataclasses import replace
from uuid import UUID

from flask import current_app

from ...extensions import db
from ...models import AgentRun, Conversation, Message
from ..errors import ServiceError
from .preparation import CompletionPreparation, iter_prepare_completion
from .prompts import AGENT_SYSTEM_INSTRUCTIONS
from .provider_errors import provider_error_code
from .provider_stream import PreparedCompletion, provider_payloads
from .runs import (
    append_event,
    build_run_activity,
    cancel_run,
    complete_run,
    fail_run,
    get_owned_run,
)
from .task_plan import active_task_id, latest_task_plan, normalize_task_plan
from .tool_snapshot import validate_tool_snapshot


def resume_completion(
    user_id: UUID,
    run_id: UUID,
    results: list[dict],
    workspace_instructions: str = "",
    tool_snapshot: object = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> CompletionPreparation:
    run = get_owned_run(user_id, run_id)
    if run.status != "waiting_tool" or not results:
        raise ServiceError("invalid_run_state", 409)
    requested = next(
        (event for event in reversed(run.events) if event.event_type == "tool.requested"), None
    )
    expected_ids = {item["id"] for item in requested.payload["toolCalls"]} if requested else set()
    if {str(item.get("callId")) for item in results} != expected_ids:
        raise ServiceError("invalid_tool_results", 422)
    tools = validate_tool_snapshot(tool_snapshot)
    run.tool_snapshot = tools
    append_event(run, "tool.output", {"results": results})
    run.status = "running"
    db.session.commit()
    return iter_prepare_completion(
        run.id,
        workspace_instructions,
        tools,
        system_instructions,
    )


def pending_tool_requests(run: AgentRun) -> list[dict]:
    requested = next(
        (event for event in reversed(run.events) if event.event_type == "tool.requested"), None
    )
    if not requested:
        return []
    assignments = requested.payload.get("taskAssignments", {})
    results = []
    for call in requested.payload.get("toolCalls", []):
        try:
            arguments = json.loads(call["function"].get("arguments") or "{}")
        except (KeyError, json.JSONDecodeError) as error:
            raise ServiceError("invalid_tool_arguments", 409) from error
        tool_name = str(call.get("function", {}).get("name") or "")
        item = {
            "type": "tool.requested",
            "runId": str(run.id),
            "callId": call["id"],
            "tool": tool_name,
            "arguments": arguments,
        }
        if task_id := assignments.get(call["id"]):
            item["taskId"] = task_id
        results.append(item)
    return results


def recover_completion(
    user_id: UUID,
    run_id: UUID,
    workspace_instructions: str = "",
    partial_content: str = "",
    partial_reasoning: str = "",
    results: list[dict] | None = None,
    tool_snapshot: object = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> CompletionPreparation | list[dict]:
    run = get_owned_run(user_id, run_id)
    if run.status == "waiting_tool":
        if results:
            return resume_completion(
                user_id,
                run_id,
                results,
                workspace_instructions,
                tool_snapshot,
                system_instructions,
            )
        run.tool_snapshot = validate_tool_snapshot(tool_snapshot)
        db.session.commit()
        return pending_tool_requests(run)
    if run.status in {"completed", "cancelled"}:
        return []
    if run.status == "running":
        cancel_run(user_id, run_id, reason="stream_recovery_conflict")
        return [{"type": "run.failed", "errorCode": "run_recovery_conflict"}]
    if run.status != "failed" or run.error_code != "client_disconnected":
        return [{"type": "run.failed", "errorCode": run.error_code or "runtime_failed"}]
    continuation = []
    partial_content = partial_content[:200_000]
    partial_reasoning = partial_reasoning[:200_000]
    if partial_content.strip():
        continuation.extend(
            [
                {"role": "assistant", "content": partial_content},
                {
                    "role": "system",
                    "content": (
                        "The previous stream disconnected. Continue directly from the "
                        "partial assistant response without repeating it."
                    ),
                },
            ]
        )
    run.status = "running"
    run.error_code = None
    run.completed_at = None
    tools = validate_tool_snapshot(tool_snapshot)
    run.tool_snapshot = tools
    append_event(run, "run.recovered", {"partialContentLength": len(partial_content)})
    db.session.commit()
    prepared_run_id = run.id

    def preparation() -> CompletionPreparation:
        prepared = yield from iter_prepare_completion(
            prepared_run_id,
            workspace_instructions,
            tools,
            system_instructions,
            continuation,
        )
        return replace(
            prepared, initial_answer=partial_content, initial_reasoning=partial_reasoning
        )

    return preparation()


def stream_completion(prepared: PreparedCompletion | CompletionPreparation):
    if isinstance(prepared, Generator):
        try:
            prepared = yield from prepared
        except ServiceError as error:
            yield {"type": "run.failed", "errorCode": error.code}
            return
    answer = prepared.initial_answer
    reasoning = prepared.initial_reasoning
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
        db.session.expire(run)
        if run.status == "cancelled":
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
                    return
                tool_name = call["function"]["name"]
                request = {"callId": call["id"], "tool": tool_name, "arguments": arguments}
                if tool_name != "update_tasks" and current_task_id:
                    request["taskId"] = current_task_id
                requests.append(request)
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
            db.session.commit()
            for request in requests:
                yield {"type": "tool.requested", "runId": str(run.id), **request}
        elif answer:
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
    except GeneratorExit:
        db.session.rollback()
        run = db.session.get(AgentRun, prepared.run_id)
        if run:
            db.session.expire(run)
        if run and run.status in {"running", "waiting_tool"}:
            fail_run(run, "client_disconnected")
        raise
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
