import json
import time
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
    iter_prepare_context,
    latest_checkpoint,
    prepare_context,
)
from .prompts import AGENT_SYSTEM_INSTRUCTIONS
from .runs import (
    append_event,
    build_run_activity,
    cancelled_run_context,
    complete_run,
    fail_run,
    get_owned_run,
    start_run,
)
from .tools import (
    AGENT_MESSAGE_TOOL,
    AGENT_TOOLS,
    FILE_TOOL_NAMES,
    FINISH_COLLABORATION_TOOL,
    VIEW_IMAGE_TOOL,
    VIEW_IMAGE_TOOL_NAME,
    normalize_terminal_arguments,
)


def _multi_agent_context(
    conversation_id: UUID, configuration: ModelConfiguration
) -> tuple[list[dict], list[dict]]:
    node = db.session.scalar(
        db.select(MultiAgentNode).where(MultiAgentNode.conversation_id == conversation_id)
    )
    if not node:
        tools = [*AGENT_TOOLS]
        if configuration.supports_vision:
            tools.append(VIEW_IMAGE_TOOL)
        return tools, []
    messages = list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .where(MultiAgentMessage.task_id == node.task_id)
            .order_by(MultiAgentMessage.sequence)
        )
    )
    mailbox = "\n\n".join(
        f"[{item.from_node.name if item.from_node else 'User'} "
        f"@ {item.to_node.name}]\n{item.content}"
        for item in messages
    )
    context = (
        [{"role": "system", "content": f"Latest collaboration group chat:\n{mailbox}"}]
        if mailbox
        else []
    )
    tools = [*AGENT_TOOLS, AGENT_MESSAGE_TOOL]
    if node.is_host:
        tools.append(FINISH_COLLABORATION_TOOL)
    if configuration.supports_vision:
        tools.append(VIEW_IMAGE_TOOL)
    return tools, context


@dataclass(frozen=True)
class PreparedCompletion:
    run_id: UUID
    conversation_id: UUID
    endpoint: str
    api_key: str
    context_length: int
    payload: dict


def _sse_json_payloads(lines):
    data_lines: list[str] = []

    def decode_event():
        if not data_lines:
            return None
        data = "\n".join(data_lines).strip()
        if not data or data == "[DONE]":
            data_lines.clear()
            return None
        payload = json.loads(data)
        data_lines.clear()
        return payload

    for line in lines:
        if line == "":
            payload = decode_event()
            if payload is not None:
                yield payload
            continue
        if line.startswith("data:"):
            if data_lines:
                try:
                    payload = decode_event()
                except json.JSONDecodeError:
                    payload = None
                else:
                    if payload is not None:
                        yield payload
            data_lines.append(line[5:].lstrip())
    payload = decode_event()
    if payload is not None:
        yield payload


def _provider_payloads(prepared: PreparedCompletion):
    request_payload = prepared.payload
    for attempt in range(MODEL_STREAM_ATTEMPTS):
        meaningful_output = False
        try:
            with httpx.stream(
                "POST",
                prepared.endpoint,
                headers={
                    "Authorization": f"Bearer {prepared.api_key}",
                    "Content-Type": "application/json",
                },
                json=request_payload,
                timeout=MODEL_REQUEST_TIMEOUT_SECONDS,
            ) as provider_response:
                provider_response.raise_for_status()
                for parsed in _sse_json_payloads(provider_response.iter_lines()):
                    choice = (parsed.get("choices") or [{}])[0]
                    delta = choice.get("delta") or {}
                    message = choice.get("message") or {}
                    if (
                        delta.get("content")
                        or delta.get("reasoning_content")
                        or delta.get("reasoning")
                        or delta.get("tool_calls")
                        or choice.get("text")
                        or message.get("content")
                        or message.get("tool_calls")
                    ):
                        meaningful_output = True
                    yield parsed
            if meaningful_output:
                return
        except httpx.HTTPStatusError as error:
            if error.response.status_code == 400 and "stream_options" in request_payload:
                request_payload = {
                    key: value
                    for key, value in request_payload.items()
                    if key != "stream_options"
                }
                continue
            retryable = error.response.status_code == 429 or error.response.status_code >= 500
            if meaningful_output or not retryable or attempt == MODEL_STREAM_ATTEMPTS - 1:
                raise
            time.sleep(min(2**attempt, 4))
        except (
            httpx.ConnectError,
            httpx.ConnectTimeout,
            httpx.ReadError,
            httpx.ReadTimeout,
            httpx.RemoteProtocolError,
        ):
            if meaningful_output or attempt == MODEL_STREAM_ATTEMPTS - 1:
                raise


def _provider_error_code(error: Exception) -> str:
    if not isinstance(error, httpx.HTTPStatusError):
        return type(error).__name__
    response = error.response
    detail = ""
    try:
        payload = response.json()
        provider_error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(provider_error, dict):
            detail = str(
                provider_error.get("code")
                or provider_error.get("type")
                or provider_error.get("message")
                or ""
            )
        elif provider_error:
            detail = str(provider_error)
    except (ValueError, TypeError):
        detail = ""
    normalized = "_".join(detail.strip().split())[:300]
    return f"provider_http_{response.status_code}{f':{normalized}' if normalized else ''}"


def prepare_completion(
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    model_id: str | None,
    edit_message_id: str | None,
    workspace_instructions: str = "",
    turn_id: UUID | None = None,
    attachments: object = None,
) -> PreparedCompletion:
    conversation = prepare_user_prompt(
        user_id, conversation_id, content, edit_message_id, attachments
    )
    configuration = get_model_configuration(user_id, model_id)
    if not configuration:
        raise ServiceError("model_not_configured", 422)
    run = start_run(conversation_id, configuration, turn_id)
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
        {
            "estimatedTokens": context.estimated_tokens,
            "contextLength": configuration.context_length,
            "compacted": context.compacted,
        },
    )
    db.session.commit()
    tools, mailbox = _multi_agent_context(conversation_id, configuration)
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        context_length=configuration.context_length,
        payload={
            "model": configuration.model,
            "stream": True,
            "stream_options": {"include_usage": True},
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


def stream_prepare_completion(
    user_id: UUID,
    conversation_id: UUID,
    content: str,
    model_id: str | None,
    edit_message_id: str | None,
    workspace_instructions: str = "",
    turn_id: UUID | None = None,
    attachments: object = None,
):
    conversation = prepare_user_prompt(
        user_id, conversation_id, content, edit_message_id, attachments
    )
    configuration = get_model_configuration(user_id, model_id)
    if not configuration:
        raise ServiceError("model_not_configured", 422)
    run = start_run(conversation_id, configuration, turn_id)
    yield {"type": "run.started", "runId": str(run.id)}
    try:
        context = yield from iter_prepare_context(
            run, configuration, list(conversation.messages), AGENT_SYSTEM_INSTRUCTIONS
        )
    except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
        fail_run(run, "context_compaction_failed")
        raise ServiceError("context_compaction_failed", 502) from error
    append_event(
        run,
        "context.prepared",
        {
            "estimatedTokens": context.estimated_tokens,
            "contextLength": configuration.context_length,
            "compacted": context.compacted,
        },
    )
    db.session.commit()
    yield {
        "type": "context.usage",
        "usedTokens": context.estimated_tokens,
        "contextLength": configuration.context_length,
        "source": "estimated",
    }
    tools, mailbox = _multi_agent_context(conversation_id, configuration)
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        context_length=configuration.context_length,
        payload={
            "model": configuration.model,
            "stream": True,
            "stream_options": {"include_usage": True},
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
                *cancelled_run_context(conversation_id, run.id),
                *mailbox,
                *context.messages,
            ],
        },
    )


def _tool_history(run: AgentRun, after_sequence: int = 0) -> list[dict]:
    history = []
    tool_names: dict[str, str] = {}
    for event in run.events:
        if event.sequence <= after_sequence:
            continue
        if event.event_type == "tool.requested":
            tool_names = {
                call["id"]: str(call.get("function", {}).get("name") or "")
                for call in event.payload["toolCalls"]
            }
            history.append(
                {
                    "role": "assistant",
                    "content": event.payload.get("content"),
                    "tool_calls": event.payload["toolCalls"],
                }
            )
        elif event.event_type == "tool.output":
            image_messages = []
            for result in event.payload["results"]:
                content = json.dumps(result["result"], ensure_ascii=False)
                if tool_names.get(result["callId"]) == VIEW_IMAGE_TOOL_NAME:
                    image_parts = _image_tool_content(result["result"])
                    if image_parts is not None:
                        content = json.dumps(
                            {
                                key: value
                                for key, value in result["result"].items()
                                if key != "dataUrl"
                            },
                            ensure_ascii=False,
                        )
                        image_messages.append({"role": "user", "content": image_parts})
                history.append(
                    {
                        "role": "tool",
                        "tool_call_id": result["callId"],
                        "content": content,
                    }
                )
            history.extend(image_messages)
    return history


def _image_tool_content(result: object) -> list[dict] | None:
    if not isinstance(result, dict):
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
            "text": f"Image returned by view_image: {json.dumps(text_payload, ensure_ascii=False)}",
        },
        {"type": "image_url", "image_url": image_url},
    ]


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
    tools, mailbox = _multi_agent_context(run.conversation_id, configuration)
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=run.conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        context_length=configuration.context_length,
        payload={
            "model": configuration.model,
            "stream": True,
            "stream_options": {"include_usage": True},
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
            yield {
                "type": "context.usage",
                "usedTokens": input_tokens_total,
                "contextLength": prepared.context_length,
                "source": "provider",
            }
        if tool_calls:
            calls = [tool_calls[index] for index in sorted(tool_calls)]
            conversation = db.session.get(Conversation, prepared.conversation_id)
            allowed_tool_names = {
                str(tool.get("function", {}).get("name") or "")
                for tool in prepared.payload.get("tools", [])
            }
            if not conversation or any(
                call["function"]["name"] not in allowed_tool_names
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
                elif tool_name in FILE_TOOL_NAMES or tool_name == VIEW_IMAGE_TOOL_NAME:
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
        error_code = _provider_error_code(error)
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
