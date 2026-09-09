from ...models import MultiAgentNode, MultiAgentTask
from .queries import task_messages


def chat_transcript(task: MultiAgentTask) -> str:
    names = {node.id: node.name for node in task.members}
    rows = []
    for message in task_messages(task):
        sender = (
            "用户"
            if message.sender_type == "user"
            else names.get(message.from_node_id, "Agent")
        )
        target = names.get(message.to_node_id, "用户")
        rows.append(f"[{sender} @ {target}]\n{message.content}")
    return "\n\n".join(rows) or "No messages yet."


def execution_prompt(node: MultiAgentNode, force_summary: bool = False) -> str:
    task = node.task
    names = {str(item.id): item.name for item in task.members}
    pending = [names[item] for item in task.execution_queue or [] if item in names]
    peers = "\n".join(
        f"- {item.name}: {item.id}{' (主持人)' if item.is_host else ''}" for item in task.members
    )
    if force_summary:
        rules = (
            "The collaboration execution limit has been reached. You must now call agent_message "
            "with to='user' and summarize the best answer supported by the work so far. "
            "Do not delegate to another agent. Clearly identify any remaining gaps."
        )
    elif node.is_host:
        rules = (
            "You are the host. Decide who should speak next. Delegate using agent_message. "
            "When the user's goal is satisfied or user input is needed, send the answer "
            "or question "
            "with agent_message to='user'. You may not delegate to yourself."
        )
    else:
        rules = (
            "Complete your assigned turn, then use agent_message to hand control to the host "
            "or another useful role. If user input is needed, send the question with to='user'. "
            "You may not delegate to yourself. If uncertain, hand control back to the host."
        )
    return f"""You are {node.name} in a single-speaker group collaboration.

Role: {node.role}
Instructions: {node.instructions}

Participants (use the UUID as `to`, or use `user` to address the user):
{peers}
- 用户: user

Latest complete group chat:
{chat_transcript(task)}

Pending speakers after this turn: {", ".join(pending) if pending else "none"}

{rules}
Only one agent runs at a time. Every agent sees the latest group chat on its next turn.
Messages are visible to the entire group even though one recipient is @mentioned. Use tools
when needed, then explicitly hand off or address the user.
Only address the user when their input is genuinely required or when providing a host summary.
If you are responding to an instruction the user injected during collaboration and speakers are
still pending, complete the instruction and hand off so the pending work can continue.
Do not send empty acknowledgements or routine status chatter."""
