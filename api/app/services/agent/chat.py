import json
from dataclasses import dataclass
from uuid import UUID

import httpx
from flask import current_app

from ...extensions import db
from ...models import (
    AgentRun,
    Conversation,
    Message,
    ModelConfiguration,
    MultiAgentMessage,
    MultiAgentNode,
)
from ..conversations import prepare_user_prompt
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key
from ..settings import get_model_configuration
from .config import MODEL_REQUEST_TIMEOUT_SECONDS, MODEL_STREAM_ATTEMPTS
from .context import (
    COMPACTION_RATIO,
    compact_payload,
    estimate_tokens,
    latest_checkpoint,
    prepare_context,
)
from .prompts import AGENT_SYSTEM_INSTRUCTIONS
from .runs import (
    append_event,
    cancelled_run_context,
    complete_run,
    fail_run,
    get_owned_run,
    start_run,
)
from .tools import AGENT_MESSAGE_TOOL, AGENT_TOOLS, FILE_TOOL_NAMES, normalize_terminal_arguments


def _multi_agent_context(conversation_id: UUID) -> tuple[list[dict], list[dict]]:
    node = db.session.scalar(
        db.select(MultiAgentNode).where(MultiAgentNode.conversation_id == conversation_id)
    )
    if not node:
        return AGENT_TOOLS, []
    messages = list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .where(
                (MultiAgentMessage.from_node_id == node.id)
                | (MultiAgentMessage.to_node_id == node.id)
            )
            .order_by(MultiAgentMessage.created_at)
        )
    )
    mailbox = "\n".join(
        f"- {item.from_node.name if item.from_node else 'User'} -> "
        f"{item.to_node.name}: {item.content}"
        for item in messages
    )
    context = (
        [{"role": "system", "content": f"Workflow agent mailbox:\n{mailbox}"}] if mailbox else []
    )
    return [*AGENT_TOOLS, AGENT_MESSAGE_TOOL], context


@dataclass(frozen=True)
class PreparedCompletion:
    run_id: UUID
    conversation_id: UUID
    endpoint: str
    api_key: str
    payload: dict


def _provider_payloads(prepared: PreparedCompletion):
    for attempt in range(MODEL_STREAM_ATTEMPTS):
        emitted = False
        try:
            with httpx.stream(
                "POST",
                prepared.endpoint,
                headers={
                    "Authorization": f"Bearer {prepared.api_key}",
                    "Content-Type": "application/json",
                },
                json=prepared.payload,
                timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
            ) as provider_response:
                provider_response.raise_for_status()
                for line in provider_response.iter_lines():
                    data = line.removeprefix("data:").strip()
                    if not data or data == "[DONE]":
                        continue
                    emitted = True
                    parsed = json.loads(data)
                    yield parsed
            if emitted:
                return
        except (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadError,
            httpx.ReadTimeout,
            httpx.RemoteProtocolError,
        ):
            if emitted or attempt == MODEL_STREAM_ATTEMPTS - 1:
                raise


def prepare_completion(
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    model_id: str | None,
    edit_message_id: str | None,
    workspace_instructions: str = "",
) -> PreparedCompletion:
    conversation = prepare_user_prompt(user_id, conversation_id, content, edit_message_id)
    configuration = get_model_configuration(user_id, model_id)
    if not configuration:
        raise ServiceError("model_not_configured", 422)
    run = start_run(conversation_id, configuration)
    try:
        context = prepare_context(
            run, configuration, list(conversation.messages), AGENT_SYSTEM_INSTRUCTIONS
        )
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
        fail_run(run, "context_compaction_failed")
        raise ServiceError("context_compaction_failed", 502) from error
    append_event(
        run,
        "context.prepared",
        {"estimatedTokens": context.estimated_tokens, "compacted": context.compacted},
    )
    db.session.commit()
    tools, mailbox = _multi_agent_context(conversation_id)
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        payload={
            "model": configuration.model,
            "stream": True,
            "tools": tools,
            "messages": [
                {
                    "role": "system",
                    "content": AGENT_SYSTEM_INSTRUCTIONS,
                },
                *(
                    [
                        {
                            "role": "system",
                            "content": f"Workspace instructions:\n{workspace_instructions}",
                        }
                    ]
                    if workspace_instructions.strip()
                    else []
                ),
                *cancelled_run_context(conversation_id, run.id),
                *mailbox,
                *context.messages,
            ],
        },
    )


def _tool_history(run: AgentRun, after_sequence: int = 0) -> list[dict]:
    history = []
    for event in run.events:
        if event.sequence <= after_sequence:
            continue
        if event.event_type == "tool.requested":
            history.append(
                {
                    "role": "assistant",
                    "content": event.payload.get("content"),
                    "tool_calls": event.payload["toolCalls"],
                }
            )
        elif event.event_type == "tool.output":
            for result in event.payload["results"]:
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": result["callId"],
                        "content": json.dumps(result["result"], ensure_ascii=False),
                    }
                )
    return history


def _message_activity(run: AgentRun, final_reasoning: str) -> list[dict]:
    activity: list[dict] = []
    tools: dict[str, dict] = {}
    for event in run.events:
        if event.event_type == "reasoning.completed" and event.payload.get("content"):
            activity.append(
                {
                    "id": f"reasoning-{event.sequence}",
                    "type": "reasoning",
                    "content": event.payload["content"],
                    "status": "completed",
                }
            )
        elif event.event_type == "message.progress" and event.payload.get("content"):
            activity.append(
                {
                    "id": f"message-{event.sequence}",
                    "type": "message",
                    "content": event.payload["content"],
                    "status": "completed",
                }
            )
        elif event.event_type == "tool.requested":
            for call in event.payload.get("toolCalls", []):
                step = {
                    "id": call["id"],
                    "type": "tool",
                    "tool": call["function"]["name"],
                    "input": call["function"].get("arguments", "{}"),
                    "status": "running",
                }
                tools[call["id"]] = step
                activity.append(step)
        elif event.event_type == "tool.output":
            for item in event.payload.get("results", []):
                if step := tools.get(item.get("callId")):
                    step["result"] = item.get("result")
                    step["status"] = "completed"
    if final_reasoning:
        activity.append(
            {
                "id": f"reasoning-final-{run.last_event_sequence}",
                "type": "reasoning",
                "content": final_reasoning,
                "status": "completed",
            }
        )
    return activity


def resume_completion(
    user_id: UUID, run_id: UUID, results: list[dict], workspace_instructions: str = ""
) -> PreparedCompletion:
    run = get_owned_run(user_id, run_id)
    if run.status != "waiting_tool" or not results:
        raise ServiceError("invalid_run_state", 409)
    requested = next(
        (event for event in reversed(run.events) if event.event_type == "tool.requested"), None
    )
    expected_ids = {item["id"] for item in requested.payload["toolCalls"]} if requested else set()
    if {str(item.get("callId")) for item in results} != expected_ids:
        raise ServiceError("invalid_tool_results", 422)
    configuration = db.session.get(ModelConfiguration, run.model_configuration_id)
    if not configuration:
        raise ServiceError("model_not_configured", 422)
    append_event(run, "tool.output", {"results": results})
    run.status = "running"
    db.session.commit()
    conversation = db.session.get(Conversation, run.conversation_id)
    if not conversation:
        raise ServiceError("not_found", 404)
    context = prepare_context(
        run, configuration, list(conversation.messages), AGENT_SYSTEM_INSTRUCTIONS
    )
    checkpoint = latest_checkpoint(run.conversation_id)
    checkpoint_sequence = 0
    if checkpoint and checkpoint.state.get("runId") == str(run.id):
        checkpoint_sequence = int(checkpoint.state.get("toolEventSequence") or 0)
    tool_history = _tool_history(run, checkpoint_sequence)
    model_messages = [*context.messages, *tool_history]
    total_estimated = context.estimated_tokens + estimate_tokens(
        json.dumps(tool_history, ensure_ascii=False)
    )
    if total_estimated >= int(configuration.context_length * COMPACTION_RATIO):
        summary = compact_payload(
            run,
            configuration,
            model_messages,
            len(conversation.messages),
            {"runId": str(run.id), "toolEventSequence": run.last_event_sequence},
        )
        model_messages = [{"role": "system", "content": f"Conversation checkpoint:\n{summary}"}]
    tools, mailbox = _multi_agent_context(run.conversation_id)
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=run.conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        payload={
            "model": configuration.model,
            "stream": True,
            "tools": tools,
            "messages": [
                {"role": "system", "content": AGENT_SYSTEM_INSTRUCTIONS},
                *(
                    [
                        {
                            "role": "system",
                            "content": f"Workspace instructions:\n{workspace_instructions}",
                        }
                    ]
                    if workspace_instructions.strip()
                    else []
                ),
                *cancelled_run_context(run.conversation_id, run.id),
                *mailbox,
                *model_messages,
            ],
        },
    )


def stream_completion(prepared: PreparedCompletion):
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
        for payload in _provider_payloads(prepared):
            usage = payload.get("usage") or {}
            input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
            output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
            if input_tokens is not None:
                input_tokens_total += int(input_tokens)
                has_input_usage = True
            if output_tokens is not None:
                output_tokens_total += int(output_tokens)
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
        if tool_calls:
            calls = [tool_calls[index] for index in sorted(tool_calls)]
            conversation = db.session.get(Conversation, prepared.conversation_id)
            if not conversation or any(
                call["function"]["name"]
                not in {"terminal", "agent_message", *FILE_TOOL_NAMES}
                for call in calls
            ):
                fail_run(run, "unsupported_tool")
                return
            requests = []
            for call in calls:
                try:
                    arguments = json.loads(call["function"]["arguments"] or "{}")
                except json.JSONDecodeError:
                    fail_run(run, "invalid_tool_arguments")
                    return
                tool_name = call["function"]["name"]
                if tool_name == "terminal":
                    arguments = {
                        **normalize_terminal_arguments(arguments),
                        "projectId": str(conversation.project_id),
                    }
                elif tool_name in FILE_TOOL_NAMES:
                    arguments = {**arguments, "projectId": str(conversation.project_id)}
                requests.append({"callId": call["id"], "tool": tool_name, "arguments": arguments})
            if reasoning:
                append_event(run, "reasoning.completed", {"content": reasoning})
            if answer:
                append_event(run, "message.progress", {"content": answer})
            append_event(run, "tool.requested", {"toolCalls": calls, "content": answer or None})
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
                activity=_message_activity(run, reasoning) or None,
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
        if run and run.status == "running":
            fail_run(run, type(error).__name__)
        current_app.logger.exception("Agent stream failed for run %s", prepared.run_id)
        # An exception escaping a streaming response makes Werkzeug close the
        # chunked HTTP body without its terminating chunk. Electron/undici then
        # reports an opaque `Invalid EOF state` instead of the actual run error.
        # Always finish the SSE protocol normally and keep the diagnostic in
        # the server log.
        yield {"type": "run.failed", "errorCode": type(error).__name__}
        return
