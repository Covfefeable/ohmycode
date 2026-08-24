from ...models import MultiAgent, MultiAgentMessage, MultiAgentTask, WorkspaceChange


def serialize_agent(agent: MultiAgent) -> dict:
    template = agent.template_flow or {}
    if not template.get("nodes") and agent.tasks:
        source = agent.tasks[-1]
        keys = {node.id: node.key for node in source.nodes}
        template = {
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
    return {
        "id": str(agent.id),
        "name": agent.name,
        "description": agent.description,
        "division": agent.division,
        "templateFlow": template,
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
    incoming = {edge.target_node_id for edge in task.edges}
    outgoing = {edge.source_node_id for edge in task.edges}
    min_x = min((float(node.position.get("x", 0)) for node in task.nodes), default=120)
    max_x = max((float(node.position.get("x", 0)) for node in task.nodes), default=120)
    boundary_status = "completed" if task.status == "completed" else ("running" if task.status == "running" else task.status)
    serialized_nodes = [
        {
            "id": "workflow_start", "key": "workflow_start", "name": "Start",
            "role": "Workflow entry", "instructions": task.request, "status": boundary_status,
            "position": {"x": min_x - 300, "y": 100}, "conversationId": None,
            "modelId": None, "finalOutput": {"content": task.request}, "messages": [], "changedFiles": [],
        },
        *[
            {
                "id": str(node.id), "key": node.key, "name": node.name, "role": node.role,
                "instructions": node.instructions, "status": node.status, "position": node.position,
                "conversationId": str(node.conversation_id) if node.conversation_id else None,
                "modelId": str(node.model_configuration_id) if node.model_configuration_id else None,
                "finalOutput": node.final_output, "messages": messages.get(str(node.id), []),
                "changedFiles": [item for item in changes if item["nodeId"] == str(node.id)],
            }
            for node in task.nodes
        ],
        {
            "id": "workflow_end", "key": "workflow_end", "name": "End",
            "role": "Workflow completion", "instructions": "Waits for all terminal agents.",
            "status": "completed" if task.status == "completed" else "pending",
            "position": {"x": max_x + 330, "y": 100}, "conversationId": None,
            "modelId": None, "finalOutput": None, "messages": [], "changedFiles": [],
        },
    ]
    serialized_edges = [
        {"id": "workflow-start-" + str(node.id), "source": "workflow_start", "target": str(node.id)}
        for node in task.nodes if node.id not in incoming
    ] + [
        {"id": str(edge.id), "source": str(edge.source_node_id), "target": str(edge.target_node_id)}
        for edge in task.edges
    ] + [
        {"id": "workflow-end-" + str(node.id), "source": str(node.id), "target": "workflow_end"}
        for node in task.nodes if node.id not in outgoing
    ]
    return {
        "id": str(task.id),
        "agentId": str(task.agent_id),
        "title": task.title,
        "request": task.request,
        "status": task.status,
        "workspacePath": task.project.path,
        "nodes": serialized_nodes,
        "edges": serialized_edges,
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
