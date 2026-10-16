from dataclasses import dataclass
from uuid import UUID

from sqlalchemy.orm import selectinload

from app.extensions import db
from app.models import AgentRun, Message, MultiAgentNode, MultiAgentTask


@dataclass(frozen=True)
class Trace:
    runs: list[AgentRun]
    answers: list[str]
    status: str


def load_trace(*, run_id: UUID | None = None, task_id: UUID | None = None) -> Trace:
    query = db.select(AgentRun).options(selectinload(AgentRun.events))
    task = None
    if task_id is not None:
        task = db.session.get(MultiAgentTask, task_id)
        if task is None:
            raise ValueError("协作任务不存在")
        query = query.join(
            MultiAgentNode, MultiAgentNode.conversation_id == AgentRun.conversation_id
        ).where(MultiAgentNode.task_id == task_id)
    else:
        query = query.where(AgentRun.id == run_id)
    runs = list(db.session.scalars(query.order_by(AgentRun.started_at, AgentRun.id)))
    if not runs:
        raise ValueError("没有找到运行记录")
    answers = list(
        db.session.scalars(
            db.select(Message.content)
            .where(Message.agent_run_id.in_([run.id for run in runs]), Message.role == "assistant")
            .order_by(Message.created_at, Message.id)
        )
    )
    return Trace(runs, answers, task.status if task else runs[0].status)
