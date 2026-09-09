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
)
from ..devices import DeviceContext
from ..errors import ServiceError
from .planner import validate_plan
from .prompts import execution_prompt
from .queries import get_task, owned_agent, owned_node, task_messages
from .state import (
    activate_next,
    clear_queue,
    current_run,
    enqueue,
    enqueue_front,
    host_for,
    next_message_sequence,
)

TASK_RESTARTABLE = {"failed", "stopped"}
TASK_MESSAGE_RESUMABLE = {"waiting_user", "failed"}
DEFAULT_EXECUTION_LIMIT = 12
MIN_EXECUTION_LIMIT = 2
MAX_EXECUTION_LIMIT = 100


def _team(agent: MultiAgent) -> dict:
    return validate_plan(agent.template_team or {})


def create_task(
    user_id: UUID, device: DeviceContext, agent_id: UUID, payload: dict
) -> MultiAgentTask:
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
        db.select(Project).where(
            Project.user_id == user_id,
            Project.device_id == device.id,
            Project.path == workspace_path,
        )
    )
    if not project:
        project = Project(
            user_id=user_id,
            device_id=device.id,
            device_name=device.name,
            name=workspace_name,
            path=workspace_path,
            kind="multi_agent",
        )
        db.session.add(project)
        db.session.flush()
    try:
        execution_limit = int(payload.get("executionLimit", DEFAULT_EXECUTION_LIMIT))
    except (TypeError, ValueError) as error:
        raise ServiceError("validation_error", 422) from error
    if not MIN_EXECUTION_LIMIT <= execution_limit <= MAX_EXECUTION_LIMIT:
        raise ServiceError("validation_error", 422)
    task = MultiAgentTask(
        agent=agent,
        project=project,
        title=str(payload.get("title") or workspace_name)[:240],
        request=request,
        status="draft",
        execution_limit=execution_limit,
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


def start_task(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running":
        raise ServiceError("workflow_not_startable", 409)
    if task.status in TASK_RESTARTABLE:
        _reset_task(task)
    elif task.status != "draft":
        raise ServiceError("workflow_not_startable", 409)
    task.status = "running"
    for node in task.members:
        node.status = "idle"
    clear_queue(task)
    enqueue(task, host_for(task))
    activate_next(task)
    db.session.commit()
    return task


def start_node(user_id: UUID, node_id: UUID) -> tuple[MultiAgentNode, str]:
    node = owned_node(user_id, node_id)
    if not node or node.task.status != "running" or node.status != "ready":
        raise ServiceError("node_not_ready", 409)
    if any(item.status == "running" for item in node.task.members):
        raise ServiceError("another_agent_is_running", 409)
    if node.task.execution_count >= node.task.execution_limit and not node.is_host:
        node.status = "idle"
        clear_queue(node.task)
        enqueue(node.task, host_for(node.task))
        activate_next(node.task)
        db.session.commit()
        raise ServiceError("collaboration_execution_limit_reached", 409)
    force_summary = node.is_host and node.task.execution_count >= node.task.execution_limit - 1
    node.status = "running"
    node.task.execution_count += 1
    db.session.commit()
    return node, execution_prompt(node, force_summary)


def recover_host(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status == "running" and not any(
        node.status in {"ready", "running"} for node in task.members
    ):
        activate_next(task)
        db.session.commit()
    return task


def post_message(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentMessage:
    source = owned_node(user_id, node_id)
    if not source or source.status != "running":
        raise ServiceError("agent_not_running", 409)
    recipient = str(payload.get("to") or "").strip()
    content = str(payload.get("content") or "").strip()
    if not content:
        raise ServiceError("validation_error", 422)
    if source.task.status != "running":
        raise ServiceError("collaboration_not_running", 409)
    if (
        source.is_host
        and source.task.execution_count >= source.task.execution_limit
        and recipient != "user"
    ):
        raise ServiceError("collaboration_host_must_summarize", 409)
    if recipient == "user":
        target = None
    else:
        try:
            target_id = UUID(recipient)
        except (TypeError, ValueError) as error:
            raise ServiceError("validation_error", 422) from error
        target = owned_node(user_id, target_id)
        if not target or target.task_id != source.task_id:
            raise ServiceError("not_found", 404)
        if target.id == source.id:
            raise ServiceError("agent_cannot_schedule_itself", 409)
        if source.task.execution_count >= source.task.execution_limit:
            target = host_for(source.task)
    message = MultiAgentMessage(
        task_id=source.task_id,
        sequence=next_message_sequence(source.task_id),
        from_node_id=source.id,
        run_id=run.id if (run := current_run(source)) else None,
        to_node_id=target.id if target else None,
        message_type="message",
        sender_type="agent",
        content=content,
    )
    db.session.add(message)
    source.status = "idle"
    if target is None:
        source.task.status = "waiting_user"
    else:
        if source.task.execution_count >= source.task.execution_limit:
            clear_queue(source.task)
        enqueue(source.task, target)
        activate_next(source.task)
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
        sequence=next_message_sequence(target.task_id),
        from_node_id=None,
        to_node_id=target.id,
        message_type="user_message",
        sender_type="user",
        content=content,
    )
    db.session.add(message)
    if target.task.status in TASK_MESSAGE_RESUMABLE:
        was_failed = target.task.status == "failed"
        target.task.status = "running"
        target.task.execution_count = 0
        if was_failed:
            clear_queue(target.task)
            target.final_output = None
        enqueue_front(target.task, target)
        activate_next(target.task)
    elif target.task.status == "running" and any(
        node.status == "running" for node in target.task.members
    ):
        enqueue(target.task, target)
    elif target.task.status == "running":
        enqueue(target.task, target)
        activate_next(target.task)
    db.session.commit()
    return message


def complete_node(user_id: UUID, node_id: UUID, payload: dict) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node or node.status != "running":
        raise ServiceError("invalid_node_state", 409)
    output = payload.get("output")
    if isinstance(output, dict):
        node.final_output = output
    content = str(output.get("content") or "").strip() if isinstance(output, dict) else ""
    node.status = "idle"
    if node.task.execution_queue:
        activate_next(node.task)
    elif content:
        db.session.add(MultiAgentMessage(
            task_id=node.task_id,
            sequence=next_message_sequence(node.task_id),
            from_node_id=node.id,
            run_id=run.id if (run := current_run(node)) else None,
            to_node_id=None,
            message_type="message",
            sender_type="agent",
            content=content,
        ))
        node.task.status = "waiting_user"
    else:
        enqueue(node.task, host_for(node.task))
        activate_next(node.task)
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
        clear_queue(node.task)
    else:
        enqueue(node.task, host_for(node.task))
        activate_next(node.task)
    db.session.commit()
    return node.task


def retry_node(user_id: UUID, node_id: UUID) -> MultiAgentTask:
    node = owned_node(user_id, node_id)
    if not node or node.status != "running" or node.task.status != "running":
        raise ServiceError("invalid_node_state", 409)
    node.status = "idle"
    enqueue_front(node.task, node)
    activate_next(node.task)
    db.session.commit()
    return node.task


def stop_task(user_id: UUID, task_id: UUID) -> MultiAgentTask:
    task = get_task(user_id, task_id)
    if not task:
        raise ServiceError("not_found", 404)
    if task.status in {"running", "waiting_user"}:
        task.status = "stopped"
        clear_queue(task)
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
    task.execution_count = 0
    clear_queue(task)
    for message in task_messages(task):
        db.session.delete(message)
    db.session.flush()
    db.session.add(
        MultiAgentMessage(
            task_id=task.id,
            sequence=1,
            from_node_id=None,
            to_node_id=host_for(task).id,
            message_type="brief",
            sender_type="user",
            content=task.request,
        )
    )
