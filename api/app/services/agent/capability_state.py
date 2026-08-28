from uuid import UUID

from ...extensions import db
from ...models import AgentEvent, AgentRun


def loaded_capability_tools(conversation_id: UUID) -> list[dict]:
    events = db.session.scalars(
        db.select(AgentEvent)
        .join(AgentRun, AgentEvent.run_id == AgentRun.id)
        .where(
            AgentRun.conversation_id == conversation_id,
            AgentEvent.event_type.in_(("tool.requested", "tool.output")),
        )
        .order_by(AgentRun.started_at, AgentEvent.sequence)
    )
    requested_loads: dict[UUID, set[str]] = {}
    capabilities: dict[str, list[dict]] = {}
    for event in events:
        if event.event_type == "tool.requested":
            requested_loads[event.run_id] = {
                str(call.get("id") or "")
                for call in event.payload.get("toolCalls", [])
                if call.get("function", {}).get("name") == "load_capability"
            }
            continue
        load_call_ids = requested_loads.get(event.run_id, set())
        for item in event.payload.get("results", []):
            if str(item.get("callId") or "") not in load_call_ids:
                continue
            result = item.get("result")
            capability_id = result.get("id") if isinstance(result, dict) else None
            tools = result.get("tools") if isinstance(result, dict) else None
            if not isinstance(capability_id, str) or not isinstance(tools, list):
                continue
            capabilities[capability_id] = [
                tool
                for tool in tools
                if isinstance(tool, dict)
                and isinstance(tool.get("function"), dict)
                and isinstance(tool["function"].get("name"), str)
            ]
    tools_by_name: dict[str, dict] = {}
    for tools in capabilities.values():
        for tool in tools:
            tools_by_name[tool["function"]["name"]] = tool
    return list(tools_by_name.values())
