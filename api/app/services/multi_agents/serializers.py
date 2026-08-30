from ...extensions import db
from ...models import AgentRun, MultiAgent, MultiAgentMessage, MultiAgentTask, WorkspaceChange
from ..agent.runs import build_run_activity
from ..devices import DeviceContext
from .planner import validate_plan


def serialize_agent(agent: MultiAgent, device: DeviceContext | None = None) -> dict:
    team = validate_plan(agent.template_team or {})
    return {
        "id": str(agent.id),
        "name": agent.name,
        "description": agent.description,
        "division": agent.division,
        "templateTeam": team,
        "createdAt": agent.created_at.isoformat(),
        "tasks": [
            {
                "id": str(task.id),
                "title": task.title,
                "status": task.status,
                "createdAt": task.created_at.isoformat(),
            }
            for task in agent.tasks
            if device is None or task.project.device_id == device.id
        ],
    }


def serialize_task(task: MultiAgentTask) -> dict:
    all_messages = [
        {
            "id": str(message.id),
            "fromNodeId": str(message.from_node_id) if message.from_node_id else None,
            "toNodeId": str(message.to_node_id) if message.to_node_id else None,
            "type": message.message_type,
            "senderType": message.sender_type,
            "content": message.content,
            "createdAt": message.created_at.isoformat(),
        }
        for message in task_messages(task)
    ]
    conversation_ids = [node.conversation_id for node in task.members if node.conversation_id]
    runs_by_conversation: dict = {}
    for run in db.session.scalars(
        db.select(AgentRun)
        .where(AgentRun.conversation_id.in_(conversation_ids))
        .order_by(AgentRun.started_at)
    ):
        runs_by_conversation.setdefault(run.conversation_id, []).append(run)
    changes = task_changes(task)
    members = []
    for node in task.members:
        runs = runs_by_conversation.get(node.conversation_id, [])
        run = runs[-1] if runs else None
        activity = [
            step for item in runs for step in build_run_activity(item, include_run_boundary=True)
        ]
        final_output = {**(node.final_output or {})}
        if activity:
            final_output["activity"] = activity
        members.append(
            {
                "id": str(node.id),
                "key": node.key,
                "name": node.name,
                "role": node.role,
                "instructions": node.instructions,
                "isHost": node.is_host,
                "status": node.status,
                "conversationId": str(node.conversation_id) if node.conversation_id else None,
                "modelId": str(node.model_configuration_id)
                if node.model_configuration_id
                else None,
                "finalOutput": final_output or None,
                "changedFiles": [item for item in changes if item["nodeId"] == str(node.id)],
                "agentStartedAt": run.started_at.isoformat() if run else None,
                "agentDurationMs": max(
                    0, round((run.completed_at - run.started_at).total_seconds() * 1000)
                )
                if run and run.completed_at
                else None,
            }
        )
    active = next((node for node in task.members if node.status in {"ready", "running"}), None)
    return {
        "id": str(task.id),
        "agentId": str(task.agent_id),
        "title": task.title,
        "request": task.request,
        "status": task.status,
        "executionLimit": task.execution_limit,
        "executionCount": task.execution_count,
        "workspacePath": task.project.path,
        "members": members,
        "messages": all_messages,
        "currentSpeakerId": str(active.id) if active else None,
        "createdAt": task.created_at.isoformat(),
        "updatedAt": task.updated_at.isoformat(),
    }


def task_messages(task: MultiAgentTask) -> list[MultiAgentMessage]:
    return list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .where(MultiAgentMessage.task_id == task.id)
            .order_by(MultiAgentMessage.sequence)
        )
    )


def task_changes(task: MultiAgentTask) -> list[dict]:
    return [
        {
            "id": str(item.id),
            "nodeId": str(item.node_id),
            "sequence": item.sequence,
            "path": item.path,
            "operation": item.operation,
            "createdAt": item.created_at.isoformat(),
        }
        for item in db.session.scalars(
            db.select(WorkspaceChange)
            .where(WorkspaceChange.task_id == task.id)
            .order_by(WorkspaceChange.sequence)
        )
    ]
