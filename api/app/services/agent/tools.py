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

READ_FILE_TOOL = {
    "type": "function",
    "function": {
        "name": "read_file",
        "description": (
            "Read a UTF-8 text file with line numbers. Inspect relevant files before editing them."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "startLine": {"type": "integer", "minimum": 1},
                "endLine": {"type": "integer", "minimum": 1},
                "maxBytes": {"type": "integer", "minimum": 1, "maximum": 262144},
            },
            "required": ["path"],
        },
    },
}

SEARCH_FILES_TOOL = {
    "type": "function",
    "function": {
        "name": "search_files",
        "description": (
            "Search workspace file names or UTF-8 file contents. "
            "Use this before broad shell searches."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "path": {"type": "string"},
                "mode": {"type": "string", "enum": ["content", "files"]},
                "glob": {"type": "string"},
                "maxResults": {"type": "integer", "minimum": 1, "maximum": 500},
            },
            "required": ["query"],
        },
    },
}

LIST_DIRECTORY_TOOL = {
    "type": "function",
    "function": {
        "name": "list_directory",
        "description": (
            "List files and directories in the workspace with bounded depth and result count."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "depth": {"type": "integer", "minimum": 1, "maximum": 5},
                "includeHidden": {"type": "boolean"},
                "maxEntries": {"type": "integer", "minimum": 1, "maximum": 1000},
            },
        },
    },
}

APPLY_PATCH_TOOL = {
    "type": "function",
    "function": {
        "name": "apply_patch",
        "description": (
            "Apply a patch inside the workspace. Read every existing target file first. The patch "
            "must start with the literal line '*** Begin Patch', use literal section headers such "
            "as '*** Update File: path/to/file', and end with the literal line '*** End Patch'. "
            "Every context line must begin with a space, '+' or '-'. "
            "Never replace '***' with '###'."
        ),
        "parameters": {
            "type": "object",
            "properties": {"patch": {"type": "string"}},
            "required": ["patch"],
        },
    },
}

FILE_TOOL_NAMES = {"read_file", "search_files", "list_directory", "apply_patch"}
AGENT_TOOLS = [
    READ_FILE_TOOL,
    SEARCH_FILES_TOOL,
    LIST_DIRECTORY_TOOL,
    APPLY_PATCH_TOOL,
    TERMINAL_TOOL,
]

AGENT_MESSAGE_TOOL = {
    "type": "function",
    "function": {
        "name": "agent_message",
        "description": (
            "Post a group-chat message and hand the single active turn to another collaboration "
            "member by exact node UUID. Everyone sees the message. You cannot target yourself."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "toNodeId": {"type": "string"},
                "content": {"type": "string"},
            },
            "required": ["toNodeId", "content"],
        },
    },
}

FINISH_COLLABORATION_TOOL = {
    "type": "function",
    "function": {
        "name": "finish_collaboration",
        "description": (
            "Host only: end the collaboration when the user goal is complete "
            "and publish the final answer."
        ),
        "parameters": {
            "type": "object",
            "properties": {"content": {"type": "string"}},
            "required": ["content"],
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
