import json
import os
import re
from collections import defaultdict, deque
from pathlib import Path
from uuid import UUID

import httpx

from ..errors import ServiceError
from ..model_credentials import decrypt_api_key
from ..settings import get_model_configuration

PLANNER_PROMPT = """You design small, practical coding-agent DAGs. Return JSON only.
The workflow must obey strict dependencies: a target starts only after every source completes.
Create 2-6 focused agent nodes. Independent nodes may run in parallel. Add one integration or
verification node when useful. Do not add project-management filler or checkpoint nodes.
Schema: {"title": string, "nodes": [{"key": string, "name": string, "role": string,
"instructions": string}], "edges": [{"source": node_key, "target": node_key}]}.
Keys must be short lowercase snake_case and unique. The graph must be acyclic."""


def workspace_outline(workspace_path: str) -> str:
    root = Path(workspace_path)
    if not root.is_dir():
        raise ServiceError("workspace_not_found", 422)
    ignored = {".git", ".venv", "node_modules", "dist", "dist-electron", "__pycache__"}
    lines: list[str] = []
    for current, directories, files in os.walk(root):
        directories[:] = sorted(item for item in directories if item not in ignored)[:20]
        relative = Path(current).relative_to(root)
        depth = len(relative.parts)
        if depth > 2:
            directories[:] = []
            continue
        for filename in sorted(files)[:30]:
            path = relative / filename
            lines.append(str(path).replace("\\", "/"))
            if len(lines) >= 160:
                return "\n".join(lines)
    return "\n".join(lines)


def _json_content(value: str) -> dict:
    cleaned = value.strip()
    fenced = re.search(r"```(?:json)?\s*(\{.*\})\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1)
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as error:
        raise ServiceError("invalid_workflow_plan", 502) from error
    if not isinstance(result, dict):
        raise ServiceError("invalid_workflow_plan", 502)
    return result


def generate_plan(
    user_id: UUID, request: str, model_id: str | None = None, workspace_path: str | None = None
) -> dict:
    model = get_model_configuration(user_id, model_id)
    if not model:
        raise ServiceError("model_not_configured", 422)
    response = httpx.post(
        f"{model.base_url.rstrip('/')}/chat/completions",
        headers={"Authorization": f"Bearer {decrypt_api_key(model.api_key_encrypted)}"},
        json={
            "model": model.model,
            "stream": False,
            "response_format": {"type": "json_object"},
            "messages": [
                {"role": "system", "content": PLANNER_PROMPT},
                {
                    "role": "user",
                    "content": f"Collaboration brief:\n{request}\n\n"
                    + (
                        f"Workspace outline:\n{workspace_outline(workspace_path)}"
                        if workspace_path
                        else (
                            "Design a reusable workflow independent of a specific "
                            "repository layout."
                        )
                    ),
                },
            ],
        },
        timeout=120,
    )
    response.raise_for_status()
    content = response.json()["choices"][0]["message"]["content"]
    return validate_plan(_json_content(content))


def validate_plan(plan: dict) -> dict:
    raw_nodes = plan.get("nodes")
    raw_edges = plan.get("edges")
    if not isinstance(raw_nodes, list) or not 1 < len(raw_nodes) <= 8:
        raise ServiceError("invalid_workflow_plan", 422)
    if not isinstance(raw_edges, list):
        raise ServiceError("invalid_workflow_plan", 422)
    nodes = []
    keys: set[str] = set()
    for index, item in enumerate(raw_nodes):
        if not isinstance(item, dict):
            raise ServiceError("invalid_workflow_plan", 422)
        key = re.sub(r"[^a-z0-9_]+", "_", str(item.get("key") or "").lower()).strip("_")
        if not key or key in keys:
            raise ServiceError("invalid_workflow_plan", 422)
        keys.add(key)
        name = str(item.get("name") or "").strip()[:160]
        role = str(item.get("role") or "").strip()[:500]
        instructions = str(item.get("instructions") or "").strip()
        model_id = str(item.get("modelId") or "").strip() or None
        if not name or not role or not instructions:
            raise ServiceError("invalid_workflow_plan", 422)
        nodes.append(
            {
                "key": key,
                "name": name,
                "role": role,
                "instructions": instructions,
                "modelId": model_id,
                "index": index,
            }
        )
    edges = []
    graph: dict[str, list[str]] = defaultdict(list)
    indegree = {key: 0 for key in keys}
    seen_edges: set[tuple[str, str]] = set()
    for item in raw_edges:
        if not isinstance(item, dict):
            raise ServiceError("invalid_workflow_plan", 422)
        source, target = str(item.get("source") or ""), str(item.get("target") or "")
        if source not in keys or target not in keys or source == target:
            raise ServiceError("invalid_workflow_plan", 422)
        if (source, target) in seen_edges:
            continue
        seen_edges.add((source, target))
        graph[source].append(target)
        indegree[target] += 1
        edges.append({"source": source, "target": target})
    queue = deque(key for key, degree in indegree.items() if degree == 0)
    layers = {key: 0 for key in queue}
    visited = 0
    while queue:
        source = queue.popleft()
        visited += 1
        for target in graph[source]:
            layers[target] = max(layers.get(target, 0), layers[source] + 1)
            indegree[target] -= 1
            if indegree[target] == 0:
                queue.append(target)
    if visited != len(nodes):
        raise ServiceError("workflow_cycle", 422)
    row_counts: dict[int, int] = defaultdict(int)
    for node in nodes:
        layer = layers.get(node["key"], 0)
        row = row_counts[layer]
        row_counts[layer] += 1
        node["position"] = {"x": 120 + layer * 330, "y": 100 + row * 190}
        node.pop("index")
    return {
        "title": str(plan.get("title") or "New task").strip()[:240],
        "nodes": nodes,
        "edges": edges,
    }
