from pathlib import PurePosixPath, PureWindowsPath
from uuid import UUID

from ...extensions import db
from ...models import (
    AgentRun,
    Conversation,
    ModelConfiguration,
    MultiAgent,
    MultiAgentMessage,
    MultiAgentNode,
    MultiAgentTask,
    Project,
    WorkspaceChange,
)
from ..errors import ServiceError
from .planner import generate_plan, validate_plan
from .queries import get_task, owned_agent, owned_node

TASK_TERMINAL = {"completed", "failed", "stopped"}


def _team(agent: MultiAgent) -> dict:
    return validate_plan(agent.template_team or {})


def _host(task: MultiAgentTask) -> MultiAgentNode:
    host = next((node for node in task.members if node.is_host), None)
    if not host:
        raise ServiceError("collaboration_host_missing", 409)
    return host


def _activate_next(task: MultiAgentTask, fallback: MultiAgentNode | None = None) -> None:
    queued = next((node for node in task.members if node.status == "queued"), None)
    (queued or fallback or _host(task)).status = "ready"


def _next_message_sequence(task_id: UUID) -> int:
    db.session.execute(
        db.select(MultiAgentTask.id).where(MultiAgentTask.id == task_id).with_for_update()
    )
    current = db.session.scalar(
        db.select(db.func.max(MultiAgentMessage.sequence)).where(
            MultiAgentMessage.task_id == task_id
        )
    )
    return (current or 0) + 1


def create_agent(user_id: UUID, payload: dict) -> MultiAgent:
    name = str(payload.get("name") or "").strip()[:200]
    description = str(payload.get("description") or "").strip()
    division = str(payload.get("division") or "").strip()
    if not name or not description or not division:
        raise ServiceError("validation_error", 422)
    supplied = payload.get("team") or payload.get("flow")
    team = (
        validate_plan(supplied)
        if isinstance(supplied, dict)
        else generate_plan(
            user_id,
            f"Name: {name}\nDescription: {description}\nDivision: {division}",
            payload.get("modelId"),
        )
    )
    agent = MultiAgent(
        user_id=user_id, name=name, description=description, division=division, template_team=team
    )
    db.session.add(agent)
    db.session.commit()
    return agent


def update_agent(user_id: UUID, agent_id: UUID, payload: dict) -> MultiAgent:
    agent = owned_agent(user_id, agent_id)
    if not agent:
        raise ServiceError("not_found", 404)
    if "name" in payload:
        agent.name = str(payload.get("name") or "").strip()[:200] or agent.name
    if "description" in payload:
        agent.description = str(payload.get("description") or "").strip()
    if "division" in payload:
        agent.division = str(payload.get("division") or "").strip()
    team = payload.get("templateTeam") or payload.get("team")
    if isinstance(team, dict):
        agent.template_team = validate_plan(team)
    db.session.commit()
    return agent


def delete_agent(user_id: UUID, agent_id: UUID) -> None:
    agent = owned_agent(user_id, agent_id)
    if not agent:
        raise ServiceError("not_found", 404)
    if any(task.status == "running" for task in agent.tasks):
        raise ServiceError("workflow_running_cannot_delete", 409)
    db.session.delete(agent)
    db.session.commit()


def create_task(user_id: UUID, agent_id: UUID, payload: dict) -> MultiAgentTask:
    agent = owned_agent(user_id, agent_id)
    if not agent:
        raise ServiceError("not_found", 404)
    workspace_path = str(payload.get("workspacePath") or "").strip()[:1024]
    workspace_name = str(payload.get("workspaceName") or "").strip()[:255]
    request = str(payload.get("request") or "").strip()
    if not workspace_path:
        raise ServiceError("validation_error", 422)
    if not request:
        raise ServiceError("validation_error", 422)
    if not workspace_name:
        posix_name = PurePosixPath(workspace_path).name
        windows_name = PureWindowsPath(workspace_path).name
        workspace_name = min(
            (name for name in (posix_name, windows_name) if name),
            key=len,
            default="workspace",
        )[:255]
    project = db.session.scalar(
        db.select(Project).where(Project.user_id == user_id, Project.path == workspace_path)
    )
    if not project:
        project = Project(
            user_id=user_id, name=workspace_name, path=workspace_path, kind="multi_agent"
        )
        db.session.add(project)
        db.session.flush()
    task = MultiAgentTask(
        agent=agent,
        project=project,
        title=str(payload.get("title") or workspace_name)[:240],
        request=request,
        status="draft",
    )
    db.session.add(task)
    db.session.flush()
    nodes = []
    for index, item in enumerate(_team(agent)["members"]):
        try:
            model_id = UUID(item["modelId"]) if item.get("modelId") else None
        except (TypeError, ValueError):
            model_id = None
        model = db.session.get(ModelConfiguration, model_id) if model_id else None
        if model and model.user_id != user_id:
            model_id = None
        conversation = Conversation(project_id=project.id, title=item["name"], kind="multi_agent")
        db.session.add(conversation)
        db.session.flush()
        node = MultiAgentNode(
            task=task,
            conversation_id=conversation.id,
            key=item["key"],
            name=item["name"],
            role=item["role"],
            instructions=item["instructions"],
            model_configuration_id=model_id,
            is_host=item["isHost"],
            status="idle",
            sort_order=index,
        )
        db.session.add(node)
        nodes.append(node)
    db.session.flush()
    host = next(node for node in nodes if node.is_host)
    db.session.add(
        MultiAgentMessage(
            task_id=task.id,
            sequence=1,
            from_node_id=None,
            to_node_id=host.id,
            message_type="brief",
            sender_type="user",
            content=request,
        )
    )
    db.session.commit()
    return task


def delete_task(user_id: UUID, task_id: UUID) -> None:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running":
        raise ServiceError("workflow_running_cannot_delete", 409)
    db.session.delete(task)
    db.session.commit()


def replace_team(user_id: UUID, task_id: UUID, payload: dict) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    raise ServiceError("collaboration_team_managed_on_template", 409)


def _chat_transcript(task: MultiAgentTask) -> str:
    names = {node.id: node.name for node in task.members}
    rows = []
    for message in task_messages(task):
        sender = (
            "用户" if message.sender_type == "user" else names.get(message.from_node_id, "Agent")
        )
        target = names.get(message.to_node_id, "主持人")
        rows.append(f"[{sender} @ {target}]\n{message.content}")
    return "\n\n".join(rows) or "No messages yet."


def _execution_prompt(node: MultiAgentNode) -> str:
    task = node.task
    peers = "\n".join(
        f"- {item.name}: {item.id}{' (主持人)' if item.is_host else ''}" for item in task.members
    )
    host_rules = (
        "You are the host. Decide who should speak next. Delegate using agent_message. "
        "When the user's goal is fully satisfied, call finish_collaboration with the final "
        "answer. You may not delegate to yourself."
        if node.is_host
        else "Complete your assigned turn, then use agent_message to hand control to the "
        "host or another useful role. "
        "You may not delegate to yourself. If uncertain, hand control back to the host."
    )
    return f"""You are {node.name} in a single-speaker group collaboration.

Role: {node.role}
Instructions: {node.instructions}

Participants (use the UUID as toNodeId):
{peers}

Latest complete group chat:
{_chat_transcript(task)}

{host_rules}
Only one agent runs at a time. Every agent sees the latest group chat on its next turn.
Messages are visible to the entire group even though one recipient is @mentioned. Use tools
when needed, then explicitly hand off or finish.
Do not send empty acknowledgements or routine status chatter."""


def start_task(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running":
        raise ServiceError("workflow_not_startable", 409)
    if task.status in TASK_TERMINAL:
        _reset_task(task)
    elif task.status != "draft":
        raise ServiceError("workflow_not_startable", 409)
    task.status = "running"
    for node in task.members:
        node.status = "idle"
    _host(task).status = "ready"
    db.session.commit()
    return task


def start_node(user_id: UUID, node_id: UUID) -> tuple[MultiAgentNode, str]:
    node = owned_node(user_id, node_id)
    if not node or node.task.status != "running" or node.status != "ready":
        raise ServiceError("node_not_ready", 409)
    if any(item.status == "running" for item in node.task.members):
        raise ServiceError("another_agent_is_running", 409)
    node.status = "running"
    db.session.commit()
    return node, _execution_prompt(node)


def recover_host(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running" and not any(
        node.status in {"ready", "running"} for node in task.members
    ):
        _host(task).status = "ready"
        db.session.commit()
    return task


def post_message(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentMessage:
    source = owned_node(user_id, node_id)
    if not source or source.status != "running":
        raise ServiceError("agent_not_running", 409)
    try:
        target_id = UUID(str(payload.get("toNodeId")))
    except (TypeError, ValueError) as error:
        raise ServiceError("validation_error", 422) from error
    target = owned_node(user_id, target_id)
    if not target or target.task_id != source.task_id:
        raise ServiceError("not_found", 404)
    if target.id == source.id:
        raise ServiceError("agent_cannot_schedule_itself", 409)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ServiceError("validation_error", 422)
    if target.task.status != "running":
        raise ServiceError("collaboration_not_running", 409)
    message = MultiAgentMessage(
        task_id=source.task_id,
        sequence=_next_message_sequence(source.task_id),
        from_node_id=source.id,
        to_node_id=target.id,
        message_type="message",
        sender_type="agent",
        content=content,
    )
    db.session.add(message)
    source.status = "idle"
    if any(node.status == "queued" for node in target.task.members):
        target.status = "queued"
        _activate_next(target.task)
    else:
        target.status = "ready"
    db.session.commit()
    return message


def post_user_message(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentMessage:
    target = owned_node(user_id, node_id)
    if not target:
        raise ServiceError("not_found", 404)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ServiceError("validation_error", 422)
    message = MultiAgentMessage(
        task_id=target.task_id,
        sequence=_next_message_sequence(target.task_id),
        from_node_id=None,
        to_node_id=target.id,
        message_type="user_message",
        sender_type="user",
        content=content,
    )
    db.session.add(message)
    if target.task.status == "running" and any(
        node.status == "running" for node in target.task.members
    ):
        if target.status != "running":
            target.status = "queued"
    elif target.task.status == "running":
        for node in target.task.members:
            if node.status == "ready":
                node.status = "idle"
        target.status = "ready"
    db.session.commit()
    return message


def finish_collaboration(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node or not node.is_host:
        raise ServiceError("only_host_can_finish_collaboration", 403)
    if node.status != "running" or node.task.status != "running":
        raise ServiceError("agent_not_running", 409)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ServiceError("final_answer_required", 422)
    node.final_output = {"content": content}
    node.status = "idle"
    node.task.status = "completed"
    db.session.add(
        MultiAgentMessage(
            task_id=node.task_id,
            sequence=_next_message_sequence(node.task_id),
            from_node_id=node.id,
            to_node_id=node.id,
            message_type="final",
            sender_type="agent",
            content=content,
        )
    )
    db.session.commit()
    return node.task


def complete_node(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node or node.status != "running":
        raise ServiceError("invalid_node_state", 409)
    output = payload.get("output")
    if isinstance(output, dict):
        node.final_output = output
    node.status = "idle"
    if node.is_host:
        if any(member.status == "queued" for member in node.task.members):
            _activate_next(node.task)
        else:
            node.task.status = "failed"
            node.final_output = {
                **(node.final_output or {}),
                "error": "host_must_delegate_or_finish",
            }
    else:
        _activate_next(node.task)
    db.session.commit()
    return node.task


def fail_node(user_id: UUID, node_id: UUID, error_code: str) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    node.status = "idle"
    node.final_output = {"error": error_code[:500]}
    if node.is_host:
        node.task.status = "failed"
    else:
        _activate_next(node.task)
    db.session.commit()
    return node.task


def stop_task(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running":
        task.status = "stopped"
        for node in task.members:
            node.status = "idle"
        db.session.commit()
    return task


def _reset_task(task: MultiAgentTask) -> None:
    conversation_ids = [node.conversation_id for node in task.members if node.conversation_id]
    for run in db.session.scalars(
        db.select(AgentRun).where(AgentRun.conversation_id.in_(conversation_ids))
    ):
        db.session.delete(run)
    for conversation in db.session.scalars(
        db.select(Conversation).where(Conversation.id.in_(conversation_ids))
    ):
        conversation.messages.clear()
    for node in task.members:
        node.status, node.final_output = "idle", None
    for message in task_messages(task):
        db.session.delete(message)
    db.session.flush()
    db.session.add(
        MultiAgentMessage(
            task_id=task.id,
            sequence=1,
            from_node_id=None,
            to_node_id=_host(task).id,
            message_type="brief",
            sender_type="user",
            content=task.request,
        )
    )


def task_messages(task: MultiAgentTask) -> list[MultiAgentMessage]:
    return list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .where(MultiAgentMessage.task_id == task.id)
            .order_by(MultiAgentMessage.sequence)
        )
    )


def record_changes(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    changes = payload.get("changes")
    if not isinstance(changes, list):
        raise ServiceError("validation_error", 422)
    current = (
        db.session.scalar(
            db.select(db.func.max(WorkspaceChange.sequence)).where(
                WorkspaceChange.task_id == node.task_id
            )
        )
        or 0
    )
    for offset, item in enumerate(changes[:500], 1):
        if isinstance(item, dict) and str(item.get("path") or "").strip():
            db.session.add(
                WorkspaceChange(
                    task_id=node.task_id,
                    node_id=node.id,
                    sequence=current + offset,
                    path=str(item["path"])[:1024],
                    operation=str(item.get("operation") or "modified")[:32],
                    before_hash=str(item.get("beforeHash") or "")[:128] or None,
                    after_hash=str(item.get("afterHash") or "")[:128] or None,
                )
            )
    db.session.commit()
    return node.task
