from collections.abc import Generator
from uuid import UUID

import httpx

from ...extensions import db
from ...models import AgentRun, Conversation, ModelConfiguration
from ..conversations import prepare_user_prompt
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key
from ..settings import get_model_configuration
from .context import iter_prepare_context
from .prompts import AGENT_SYSTEM_INSTRUCTIONS
from .provider_stream import PreparedCompletion
from .runs import append_event, cancelled_run_context, fail_run, start_run
from .task_plan import task_plan_context
from .tool_snapshot import validate_tool_snapshot

CompletionPreparation = Generator[dict, None, PreparedCompletion]


def iter_prepare_completion(
    run_id: UUID,
    workspace_instructions: str,
    tools: list[dict],
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
    continuation: list[dict] | None = None,
) -> CompletionPreparation:
    run = db.session.get(AgentRun, run_id)
    if not run:
        raise ServiceError("not_found", 404)
    try:
        configuration = db.session.get(ModelConfiguration, run.model_configuration_id)
        if not configuration:
            raise ServiceError("model_not_configured", 422)
        conversation = db.session.get(Conversation, run.conversation_id)
        context = yield from iter_prepare_context(
            run,
            configuration,
            list(conversation.messages),
            [
                {"role": "system", "content": system_instructions},
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
                *task_plan_context(run),
            ],
            tools,
            continuation or [],
        )
    except ServiceError as error:
        fail_run(run, error.code)
        raise
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
    payload = {
        "model": configuration.model,
        "stream": True,
        "stream_options": {"include_usage": True},
        "messages": context.messages,
    }
    if tools:
        payload["tools"] = tools
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=run.conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        context_length=configuration.context_length,
        payload=payload,
        estimated_input_tokens=context.estimated_tokens,
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
    tool_snapshot: object = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
):
    tools = validate_tool_snapshot(tool_snapshot)
    prepare_user_prompt(
        user_id, conversation_id, content, edit_message_id, attachments
    )
    configuration = get_model_configuration(user_id, model_id)
    if not configuration:
        raise ServiceError("model_not_configured", 422)
    run = start_run(conversation_id, configuration, turn_id, tools)
    yield {"type": "run.started", "runId": str(run.id)}
    return (
        yield from iter_prepare_completion(
            run.id,
            workspace_instructions,
            tools,
            system_instructions,
        )
    )
