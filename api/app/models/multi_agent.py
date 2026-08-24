from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from ..extensions import db

if TYPE_CHECKING:
    from .conversation import Conversation
    from .project import Project


class MultiAgent(db.Model):
    __tablename__ = "multi_agents"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("projects.id", ondelete="SET NULL"), nullable=True, index=True
    )
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    division: Mapped[str] = mapped_column(Text, default="")
    template_flow: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    project: Mapped[Project | None] = relationship()
    tasks: Mapped[list[MultiAgentTask]] = relationship(
        back_populates="agent", cascade="all, delete-orphan", order_by="MultiAgentTask.created_at"
    )


class MultiAgentTask(db.Model):
    __tablename__ = "multi_agent_tasks"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    agent_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agents.id", ondelete="CASCADE"), index=True
    )
    project_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), index=True
    )
    title: Mapped[str] = mapped_column(String(240))
    request: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="draft", index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    agent: Mapped[MultiAgent] = relationship(back_populates="tasks")
    project: Mapped[Project] = relationship()
    nodes: Mapped[list[MultiAgentNode]] = relationship(
        back_populates="task", cascade="all, delete-orphan", order_by="MultiAgentNode.sort_order"
    )
    edges: Mapped[list[MultiAgentEdge]] = relationship(
        back_populates="task", cascade="all, delete-orphan"
    )


class MultiAgentNode(db.Model):
    __tablename__ = "multi_agent_nodes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_tasks.id", ondelete="CASCADE"), index=True
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    model_configuration_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("model_configurations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    key: Mapped[str] = mapped_column(String(100))
    name: Mapped[str] = mapped_column(String(160))
    role: Mapped[str] = mapped_column(String(500))
    instructions: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    position: Mapped[dict] = mapped_column(JSON, default=dict)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    final_output: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    task: Mapped[MultiAgentTask] = relationship(back_populates="nodes")
    conversation: Mapped[Conversation | None] = relationship()


class MultiAgentEdge(db.Model):
    __tablename__ = "multi_agent_edges"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_tasks.id", ondelete="CASCADE"), index=True
    )
    source_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_nodes.id", ondelete="CASCADE"), index=True
    )
    target_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_nodes.id", ondelete="CASCADE"), index=True
    )
    task: Mapped[MultiAgentTask] = relationship(back_populates="edges")


class MultiAgentMessage(db.Model):
    __tablename__ = "multi_agent_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_tasks.id", ondelete="CASCADE"), index=True
    )
    from_node_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("multi_agent_nodes.id", ondelete="CASCADE"), index=True, nullable=True
    )
    to_node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_nodes.id", ondelete="CASCADE"), index=True
    )
    message_type: Mapped[str] = mapped_column(String(32), default="update")
    sender_type: Mapped[str] = mapped_column(String(16), default="agent")
    content: Mapped[str] = mapped_column(Text)
    expects_reply: Mapped[bool] = mapped_column(Boolean, default=False)
    reply_to_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("multi_agent_messages.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    from_node: Mapped[MultiAgentNode | None] = relationship(foreign_keys=[from_node_id])
    to_node: Mapped[MultiAgentNode] = relationship(foreign_keys=[to_node_id])


class WorkspaceChange(db.Model):
    __tablename__ = "workspace_changes"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    task_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_tasks.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("multi_agent_nodes.id", ondelete="CASCADE"), index=True
    )
    sequence: Mapped[int] = mapped_column(Integer)
    path: Mapped[str] = mapped_column(String(2048))
    operation: Mapped[str] = mapped_column(String(20))
    before_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    after_hash: Mapped[str | None] = mapped_column(String(128), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
