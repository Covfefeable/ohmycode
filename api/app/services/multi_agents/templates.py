from uuid import UUID

from ...extensions import db
from ...models import MultiAgent
from ..errors import ServiceError
from .planner import generate_plan, validate_plan
from .queries import owned_agent


def create_agent(user_id: UUID, payload: dict) -> MultiAgent:
    name = str(payload.get("name") or "").strip()[:200]
    description = str(payload.get("description") or "").strip()
    division = str(payload.get("division") or "").strip()
    if not name or not description or not division:
        raise ServiceError("validation_error", 422)
    supplied = payload.get("team") or payload.get("flow")
    team = (
        validate_plan(supplied)
        if isinstance(supplied, dict)
        else generate_plan(
            user_id,
            f"Name: {name}\nDescription: {description}\nDivision: {division}",
            payload.get("modelId"),
        )
    )
    agent = MultiAgent(
        user_id=user_id,
        name=name,
        description=description,
        division=division,
        template_team=team,
    )
    db.session.add(agent)
    db.session.commit()
    return agent


def update_agent(user_id: UUID, agent_id: UUID, payload: dict) -> MultiAgent:
    agent = owned_agent(user_id, agent_id)
    if not agent:
        raise ServiceError("not_found", 404)
    if "name" in payload:
        agent.name = str(payload.get("name") or "").strip()[:200] or agent.name
    if "description" in payload:
        agent.description = str(payload.get("description") or "").strip()
    if "division" in payload:
        agent.division = str(payload.get("division") or "").strip()
    team = payload.get("templateTeam") or payload.get("team")
    if isinstance(team, dict):
        agent.template_team = validate_plan(team)
    db.session.commit()
    return agent


def delete_agent(user_id: UUID, agent_id: UUID) -> None:
    agent = owned_agent(user_id, agent_id)
    if not agent:
        raise ServiceError("not_found", 404)
    if any(task.status == "running" for task in agent.tasks):
        raise ServiceError("workflow_running_cannot_delete", 409)
    db.session.delete(agent)
    db.session.commit()
