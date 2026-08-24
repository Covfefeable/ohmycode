TERMINAL_TOOL = {
    "type": "function",
    "function": {
        "name": "terminal",
        "description": (
            "Start, inspect, interact with, stop, or list persistent local terminals. "
            "For a running command, read waits until it exits or yieldMs elapses; use a "
            "5-30 second yieldMs for installs, builds, downloads, and other long tasks."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": ["start", "read", "write", "stop", "list"],
                },
                "command": {"type": "string"},
                "cwd": {"type": "string"},
                "terminalId": {"type": "string"},
                "afterCursor": {"type": "integer"},
                "yieldMs": {"type": "integer", "minimum": 0, "maximum": 30000},
                "input": {"type": "string"},
                "intent": {"type": "string", "enum": ["read", "write"]},
            },
            "required": ["action"],
        },
    },
}

AGENT_TOOLS = [TERMINAL_TOOL]

AGENT_MESSAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "agent_message",
        "description": (
            "Communicate with another already-started workflow agent by its exact node UUID. "
            "Use proactively for cross-agent discoveries, upstream questions, review revisions, "
            "and revision handoffs. A completed target resumes its existing conversation. "
            "Never message a pending/ready agent that has not started, including an unstarted "
            "downstream node. For revision requests use intent=revision_request and "
            "expectsReply=true; reply with intent=revision_result."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "toNodeId": {"type": "string"},
                "content": {"type": "string"},
                "expectsReply": {"type": "boolean"},
                "intent": {"type": "string", "enum": ["inform", "question", "revision_request", "revision_result"]},
                "replyToId": {"type": "string"},
            },
            "required": ["toNodeId", "content"],
        },
    },
}


def normalize_terminal_arguments(arguments: object) -> dict:
    if not isinstance(arguments, dict):
        return {"action": "list"}
    normalized = dict(arguments)
    if not normalized.get("action"):
        if normalized.get("command"):
            normalized["action"] = "start"
        elif normalized.get("terminalId") and "input" in normalized:
            normalized["action"] = "write"
        elif normalized.get("terminalId"):
            normalized["action"] = "read"
        else:
            normalized["action"] = "list"
    return normalized
