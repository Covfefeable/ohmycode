from ...models import MultiAgent, MultiAgentMessage, MultiAgentTask, WorkspaceChange


def serialize_agent(agent: MultiAgent) -> dict:
    return {
        "id": str(agent.id),
        "name": agent.name,
        "workspacePath": agent.project.path,
        "createdAt": agent.created_at.isoformat(),
        "tasks": [
            {
                "id": str(task.id),
                "title": task.title,
                "status": task.status,
                "createdAt": task.created_at.isoformat(),
            }
            for task in agent.tasks
        ],
    }


def serialize_task(task: MultiAgentTask) -> dict:
    messages = {str(node.id): [] for node in task.nodes}
    for message in task_messages(task):
        payload = {
            "id": str(message.id),
            "fromNodeId": str(message.from_node_id),
            "toNodeId": str(message.to_node_id),
            "type": message.message_type,
            "content": message.content,
            "expectsReply": message.expects_reply,
            "replyToId": str(message.reply_to_id) if message.reply_to_id else None,
            "createdAt": message.created_at.isoformat(),
        }
        messages.setdefault(str(message.from_node_id), []).append(payload)
        messages.setdefault(str(message.to_node_id), []).append(payload)
    changes = task_changes(task)
    return {
        "id": str(task.id),
        "agentId": str(task.agent_id),
        "title": task.title,
        "request": task.request,
        "status": task.status,
        "workspacePath": task.agent.project.path,
        "nodes": [
            {
                "id": str(node.id),
                "key": node.key,
                "name": node.name,
                "role": node.role,
                "instructions": node.instructions,
                "status": node.status,
                "position": node.position,
                "conversationId": str(node.conversation_id) if node.conversation_id else None,
                "finalOutput": node.final_output,
                "messages": messages.get(str(node.id), []),
                "changedFiles": [item for item in changes if item["nodeId"] == str(node.id)],
            }
            for node in task.nodes
        ],
        "edges": [
            {
                "id": str(edge.id),
                "source": str(edge.source_node_id),
                "target": str(edge.target_node_id),
            }
            for edge in task.edges
        ],
        "createdAt": task.created_at.isoformat(),
        "updatedAt": task.updated_at.isoformat(),
    }


def task_messages(task: MultiAgentTask) -> list[MultiAgentMessage]:
    from ...extensions import db

    return list(
        db.session.scalars(
            db.select(MultiAgentMessage)
            .where(MultiAgentMessage.task_id == task.id)
            .order_by(MultiAgentMessage.created_at)
        )
    )


def task_changes(task: MultiAgentTask) -> list[dict]:
    from ...extensions import db

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
