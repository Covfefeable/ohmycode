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
            },
            "required": ["action"],
        },
    },
}

AGENT_TOOLS = [TERMINAL_TOOL]


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
