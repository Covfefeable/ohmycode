from pathlib import Path
from uuid import UUID

from ...extensions import db
from ...models import (
    AgentRun,
    Conversation,
    ModelConfiguration,
    MultiAgent,
    MultiAgentEdge,
    MultiAgentMessage,
    MultiAgentNode,
    MultiAgentTask,
    Project,
    WorkspaceChange,
)
from ..errors import ServiceError
from .planner import END_KEY, START_KEY, generate_plan, validate_plan
from .queries import get_task, owned_agent, owned_node
from .state_machine import (
    NODE_ACTIVE,
    TASK_TERMINAL,
    refresh_graph,
    reset_node,
    transition_node,
    transition_task,
)


def _reusable_flow(agent: MultiAgent) -> dict:
    if (agent.template_flow or {}).get("nodes"):
        return agent.template_flow
    if not agent.tasks:
        raise ServiceError("invalid_workflow_plan", 422)
    source = agent.tasks[-1]
    keys = {node.id: node.key for node in source.nodes}
    return {
        "title": source.title,
        "nodes": [
            {
                "key": node.key,
                "name": node.name,
                "role": node.role,
                "instructions": node.instructions,
                "modelId": (
                    str(node.model_configuration_id) if node.model_configuration_id else None
                ),
                "position": node.position,
            }
            for node in source.nodes
        ],
        "edges": [
            {"source": keys[edge.source_node_id], "target": keys[edge.target_node_id]}
            for edge in source.edges
        ],
    }


def create_agent(user_id: UUID, payload: dict) -> MultiAgent:
    name = str(payload.get("name") or "").strip()[:200]
    description = str(payload.get("description") or "").strip()
    division = str(payload.get("division") or "").strip()
    if not name or not description or not division:
        raise ServiceError("validation_error", 422)
    supplied = payload.get("flow")
    flow = (
        validate_plan(supplied)
        if isinstance(supplied, dict)
        else generate_plan(
            user_id,
            f"Name: {name}\nDescription: {description}\nDivision: {division}",
            payload.get("modelId"),
        )
    )
    agent = MultiAgent(
        user_id=user_id,
        name=name,
        description=description,
        division=division,
        template_flow=flow,
    )
    db.session.add(agent)
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
    if not workspace_path or not Path(workspace_path).is_dir():
        raise ServiceError("workspace_not_found", 422)
    project = db.session.scalar(
        db.select(Project).where(Project.user_id == user_id, Project.path == workspace_path)
    )
    if not project:
        project = Project(
            user_id=user_id,
            name=Path(workspace_path).name,
            path=workspace_path,
            kind="multi_agent",
        )
        db.session.add(project)
        db.session.flush()
    plan = validate_plan(_reusable_flow(agent))
    task = MultiAgentTask(
        agent=agent,
        project=project,
        title=str(payload.get("title") or Path(workspace_path).name)[:240],
        request=str(payload.get("request") or agent.description).strip(),
        status="draft",
    )
    db.session.add(task)
    db.session.flush()
    nodes_by_key: dict[str, MultiAgentNode] = {}
    executable_nodes = [item for item in plan["nodes"] if item["key"] not in {START_KEY, END_KEY}]
    for index, item in enumerate(executable_nodes):
        try:
            model_configuration_id = UUID(item["modelId"]) if item.get("modelId") else None
        except (TypeError, ValueError) as error:
            raise ServiceError("model_not_configured", 422) from error
        model = (
            db.session.get(ModelConfiguration, model_configuration_id)
            if model_configuration_id
            else None
        )
        if model_configuration_id and (not model or model.user_id != user_id):
            model_configuration_id = None
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
            model_configuration_id=model_configuration_id,
            position=item["position"],
            sort_order=index,
        )
        db.session.add(node)
        nodes_by_key[item["key"]] = node
    db.session.flush()
    for item in plan["edges"]:
        if item["source"] in {START_KEY, END_KEY} or item["target"] in {START_KEY, END_KEY}:
            continue
        db.session.add(
            MultiAgentEdge(
                task=task,
                source_node_id=nodes_by_key[item["source"]].id,
                target_node_id=nodes_by_key[item["target"]].id,
            )
        )
    db.session.commit()
    return task


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
    flow = payload.get("templateFlow", payload.get("flow"))
    if isinstance(flow, dict):
        agent.template_flow = validate_plan(flow)
    db.session.commit()
    return agent


def replace_flow(user_id: UUID, task_id: UUID, payload: dict) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status != "draft":
        raise ServiceError("workflow_locked", 409)
    positions = payload.get("positions")
    if isinstance(positions, dict):
        for node in task.nodes:
            value = positions.get(str(node.id))
            if isinstance(value, dict):
                node.position = {"x": float(value.get("x", 0)), "y": float(value.get("y", 0))}
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


def post_message(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentMessage:
    source = owned_node(user_id, node_id)
    if not source:
        raise ServiceError("not_found", 404)
    try:
        target_id = UUID(str(payload.get("toNodeId")))
    except (TypeError, ValueError) as error:
        raise ServiceError("validation_error", 422) from error
    target = owned_node(user_id, target_id)
    if not target or target.task_id != source.task_id:
        raise ServiceError("not_found", 404)
    if target.status in {"pending", "ready"}:
        raise ServiceError("target_agent_not_started", 409)
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ServiceError("validation_error", 422)
    intent = str(payload.get("intent") or payload.get("type") or "inform")[:32]
    expects_reply = bool(payload.get("expectsReply")) or intent == "revision_request"
    try:
        reply_to_id = UUID(str(payload.get("replyToId"))) if payload.get("replyToId") else None
    except (TypeError, ValueError) as error:
        raise ServiceError("validation_error", 422) from error
    history = list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .where(MultiAgentMessage.task_id == source.task_id)
            .order_by(MultiAgentMessage.created_at, MultiAgentMessage.id)
        )
    )
    normalized_content = " ".join(content.casefold().split())
    last_related = next(
        (
            item
            for item in reversed(history)
            if item.from_node_id == source.id or item.to_node_id == source.id
        ),
        None,
    )
    if (
        last_related
        and last_related.from_node_id == source.id
        and last_related.to_node_id == target.id
        and last_related.message_type == intent
        and " ".join(last_related.content.casefold().split()) == normalized_content
    ):
        raise ServiceError("duplicate_agent_message", 409)
    if expects_reply:
        latest_request = next(
            (
                item
                for item in reversed(history)
                if item.from_node_id == source.id
                and item.to_node_id == target.id
                and item.expects_reply
            ),
            None,
        )
        if latest_request and not any(
            item.from_node_id == target.id
            and item.to_node_id == source.id
            and not item.expects_reply
            and item.created_at >= latest_request.created_at
            for item in history
        ):
            raise ServiceError("agent_request_already_pending", 409)
    message = MultiAgentMessage(
        task_id=source.task_id,
        from_node_id=source.id,
        to_node_id=target.id,
        message_type=intent,
        sender_type="agent",
        content=content,
        expects_reply=expects_reply,
        reply_to_id=reply_to_id,
    )
    db.session.add(message)
    if expects_reply:
        transition_node(source, "paused")
    should_wake_target = expects_reply or intent == "revision_result" or reply_to_id is not None
    if should_wake_target and target.status in {"completed", "paused"}:
        transition_node(target, "running")
        if target.task.status == "completed":
            transition_task(target.task, "running")
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
        from_node_id=None,
        to_node_id=target.id,
        message_type="user_adjustment",
        sender_type="user",
        content=content,
        expects_reply=False,
    )
    db.session.add(message)
    db.session.commit()
    return message


def _refresh_ready_nodes(task: MultiAgentTask) -> None:
    if refresh_graph(_execution_nodes(task), _execution_edges(task)) and task.status == "running":
        transition_task(task, "completed")


def _reset_task_run(task: MultiAgentTask) -> None:
    conversation_ids = [
        node.conversation_id for node in _execution_nodes(task) if node.conversation_id
    ]
    if conversation_ids:
        for run in db.session.scalars(
            db.select(AgentRun).where(AgentRun.conversation_id.in_(conversation_ids))
        ):
            db.session.delete(run)
        for conversation in db.session.scalars(
            db.select(Conversation).where(Conversation.id.in_(conversation_ids))
        ):
            conversation.messages.clear()
    for node in _execution_nodes(task):
        reset_node(node)
    for message in list(
        db.session.scalars(db.select(MultiAgentMessage).where(MultiAgentMessage.task_id == task.id))
    ):
        db.session.delete(message)
    for change in list(
        db.session.scalars(db.select(WorkspaceChange).where(WorkspaceChange.task_id == task.id))
    ):
        db.session.delete(change)


def start_task(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running":
        raise ServiceError("workflow_not_startable", 409)
    if task.status in TASK_TERMINAL:
        _reset_task_run(task)
    elif task.status != "draft":
        raise ServiceError("workflow_not_startable", 409)
    transition_task(task, "running")
    _refresh_ready_nodes(task)
    db.session.commit()
    return task


def _node_execution_prompt(node: MultiAgentNode) -> str:
    task = node.task
    upstream_ids = {
        edge.source_node_id for edge in _execution_edges(task) if edge.target_node_id == node.id
    }
    upstream = [item for item in _execution_nodes(task) if item.id in upstream_ids]
    outputs = (
        "\n\n".join(f"[{item.name}]\n{item.final_output}" for item in upstream if item.final_output)
        or "No upstream nodes."
    )
    peers = ", ".join(
        f"{item.name} ({item.id}, {item.status})"
        for item in _execution_nodes(task)
        if item.id != node.id
    )
    return f"""You are the {node.name} node in a multi-agent workflow.

Original request:
{task.request}

Your role:
{node.role}

Your instructions:
{node.instructions}

Completed upstream outputs:
{outputs}

Other workflow agents (use the UUID in parentheses as toNodeId):
{peers}

Work only on this node's responsibility. Use the existing terminal capability normally. For
terminal start actions, set intent to read only when the command cannot modify the workspace;
otherwise set intent to write.

Agent communication is part of your job, not an optional fallback. Use agent_message with the exact
toNodeId shown above when a parallel agent needs a discovery, when you need clarification from an
already-started upstream agent, when review requires revision, and when a revised result is ready.
Use intent=revision_request and expectsReply=true to return completed work for changes; this pauses
you until the target answers. The target will resume its existing conversation, not restart. Reply
with intent=revision_result when the requested revision is complete. You may message running,
paused, or completed agents. You must not message a pending/ready agent that has not started yet,
especially a downstream node; the tool will return target_agent_not_started and you must continue
without retrying that invalid route. Keep messages concise, actionable, and non-duplicative.

Ordinary inform messages are recorded for visibility but never wake a completed agent. Only send a
revision_request when the target must do more work, and send exactly one revision_result when that
work is finished. Do not repeat a request while it is awaiting a result, and do not acknowledge an
acknowledgement. The service rejects duplicate messages and overlapping revision requests.

Finish with a concise result that states work completed, files changed, tests run, decisions, and
remaining risks."""


def start_node(user_id: UUID, node_id: UUID) -> tuple[MultiAgentNode, str]:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    if node.task.status != "running" or node.status != "ready":
        raise ServiceError("node_not_ready", 409)
    transition_node(node, "running")
    db.session.commit()
    return node, _node_execution_prompt(node)


def wake_node(user_id: UUID, node_id: UUID) -> MultiAgentNode:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    if node.status not in {"completed", "paused"}:
        raise ServiceError("node_not_resumable", 409)
    transition_node(node, "running")
    if node.task.status == "completed":
        transition_task(node.task, "running")
    db.session.commit()
    return node


def complete_node(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    if node.status != "running":
        raise ServiceError("invalid_node_state", 409)
    output = payload.get("output")
    if not isinstance(output, dict) or not str(output.get("content") or "").strip():
        raise ServiceError("node_output_required", 422)
    node.final_output = output
    transition_node(node, "completed")
    task = node.task
    _refresh_ready_nodes(task)
    db.session.commit()
    return task


def fail_node(user_id: UUID, node_id: UUID, error_code: str) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node:
        raise ServiceError("not_found", 404)
    transition_node(node, "failed")
    node.final_output = {"error": error_code[:500]}
    transition_task(node.task, "failed")
    for sibling in node.task.nodes:
        if sibling.id != node.id and sibling.status in NODE_ACTIVE:
            transition_node(sibling, "stopped")
    db.session.commit()
    return node.task


def stop_task(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running":
        transition_task(task, "stopped")
        for node in task.nodes:
            if node.status in NODE_ACTIVE:
                transition_node(node, "stopped")
        db.session.commit()
    return task


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
    for offset, item in enumerate(changes[:500], start=1):
        if not isinstance(item, dict) or not str(item.get("path") or "").strip():
            continue
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


def _execution_nodes(task: MultiAgentTask) -> list[MultiAgentNode]:
    return [node for node in task.nodes if node.key not in {START_KEY, END_KEY}]


def _execution_edges(task: MultiAgentTask) -> list[MultiAgentEdge]:
    node_ids = {node.id for node in _execution_nodes(task)}
    return [
        edge
        for edge in task.edges
        if edge.source_node_id in node_ids and edge.target_node_id in node_ids
    ]
