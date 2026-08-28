from uuid import UUID

import httpx

from ...extensions import db
from ...models import AgentRun, ModelConfiguration, MultiAgentMessage, MultiAgentNode
from ..conversations import prepare_user_prompt
from ..errors import ServiceError
from ..model_credentials import decrypt_api_key
from ..settings import get_model_configuration
from .capability_state import loaded_capability_tools
from .context import iter_prepare_context
from .prompts import AGENT_SYSTEM_INSTRUCTIONS
from .provider_stream import PreparedCompletion
from .runs import append_event, cancelled_run_context, fail_run, start_run
from .task_plan import task_plan_context
from .tools import (
    AGENT_MESSAGE_TOOL,
    AGENT_TOOLS,
    FINISH_COLLABORATION_TOOL,
    UPDATE_TASKS_TOOL,
    VIEW_IMAGE_TOOL,
)


def completion_tools_and_mailbox(
    conversation_id: UUID, configuration: ModelConfiguration
) -> tuple[list[dict], list[dict]]:
    node = db.session.scalar(
        db.select(MultiAgentNode).where(MultiAgentNode.conversation_id == conversation_id)
    )
    if not node:
        tools = [*AGENT_TOOLS, UPDATE_TASKS_TOOL]
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


def completion_payload(
    run: AgentRun,
    configuration: ModelConfiguration,
    messages: list[dict],
    workspace_instructions: str,
    mailbox: list[dict],
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> dict:
    return {
        "model": configuration.model,
        "stream": True,
        "stream_options": {"include_usage": True},
        "messages": [
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
            *mailbox,
            *messages,
        ],
    }


def prepared_completion(
    run: AgentRun,
    configuration: ModelConfiguration,
    messages: list[dict],
    workspace_instructions: str,
    tools: list[dict],
    mailbox: list[dict],
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
) -> PreparedCompletion:
    payload = completion_payload(
        run, configuration, messages, workspace_instructions, mailbox, system_instructions
    )
    if tools:
        payload["tools"] = tools
    return PreparedCompletion(
        run_id=run.id,
        conversation_id=run.conversation_id,
        endpoint=f"{configuration.base_url.rstrip('/')}/chat/completions",
        api_key=decrypt_api_key(configuration.api_key_encrypted),
        context_length=configuration.context_length,
        payload=payload,
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
    tools_enabled: bool = True,
    tools_override: list[dict] | None = None,
    system_instructions: str = AGENT_SYSTEM_INSTRUCTIONS,
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
            run, configuration, list(conversation.messages), system_instructions
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
    if tools_override is not None:
        tools, mailbox = [*tools_override, *loaded_capability_tools(conversation_id)], []
    else:
        tools, mailbox = (
            completion_tools_and_mailbox(conversation_id, configuration)
            if tools_enabled
            else ([], [])
        )
        if tools_enabled:
            tools.extend(loaded_capability_tools(conversation_id))
    return prepared_completion(
        run,
        configuration,
        context.messages,
        workspace_instructions,
        tools,
        mailbox,
        system_instructions,
    )
