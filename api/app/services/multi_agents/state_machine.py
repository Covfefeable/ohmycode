from collections.abc import Iterable

from ...models import MultiAgentEdge, MultiAgentNode, MultiAgentTask

TASK_TERMINAL = frozenset({"completed", "failed", "stopped"})
NODE_ACTIVE = frozenset({"ready", "running", "paused"})
NODE_TERMINAL = frozenset({"completed", "failed", "stopped"})

TASK_TRANSITIONS = {
    "draft": frozenset({"running"}),
    "running": frozenset({"completed", "failed", "stopped"}),
    "completed": frozenset({"running"}),
    "failed": frozenset({"running"}),
    "stopped": frozenset({"running"}),
}

NODE_TRANSITIONS = {
    "pending": frozenset({"ready", "stopped"}),
    "ready": frozenset({"running", "stopped"}),
    "running": frozenset({"paused", "completed", "failed", "stopped"}),
    "paused": frozenset({"running", "stopped"}),
    "completed": frozenset({"running", "paused"}),
    "failed": frozenset(),
    "stopped": frozenset(),
}


def transition_task(task: MultiAgentTask, target: str) -> None:
    if target == task.status:
        return
    if target not in TASK_TRANSITIONS.get(task.status, frozenset()):
        raise ValueError(f"invalid task transition: {task.status} -> {target}")
    task.status = target


def transition_node(node: MultiAgentNode, target: str) -> None:
    if target == node.status:
        return
    if target not in NODE_TRANSITIONS.get(node.status, frozenset()):
        raise ValueError(f"invalid node transition: {node.status} -> {target}")
    node.status = target


def refresh_graph(nodes: Iterable[MultiAgentNode], edges: Iterable[MultiAgentEdge]) -> bool:
    node_list = list(nodes)
    completed = {node.id for node in node_list if node.status == "completed" and node.final_output}
    incoming = {node.id: set() for node in node_list}
    for edge in edges:
        if edge.target_node_id in incoming:
            incoming[edge.target_node_id].add(edge.source_node_id)
    for node in node_list:
        if node.status == "pending" and incoming[node.id].issubset(completed):
            transition_node(node, "ready")
    return bool(node_list) and all(node.status == "completed" for node in node_list)


def reset_node(node: MultiAgentNode) -> None:
    node.status = "pending"
    node.final_output = None
