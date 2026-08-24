"""add multi agent workflows

Revision ID: h68fd354ca73
Revises: g57ec243bf62
"""

import sqlalchemy as sa
from alembic import op

revision = "h68fd354ca73"
down_revision = "g57ec243bf62"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "projects",
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="workspace"),
    )
    op.create_index("ix_projects_kind", "projects", ["kind"], unique=False)
    op.add_column(
        "conversations",
        sa.Column("kind", sa.String(length=32), nullable=False, server_default="chat"),
    )
    op.create_index("ix_conversations_kind", "conversations", ["kind"], unique=False)
    op.create_table(
        "multi_agents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("project_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["project_id"], ["projects.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_multi_agents_project_id", "multi_agents", ["project_id"])
    op.create_index("ix_multi_agents_user_id", "multi_agents", ["user_id"])
    op.create_table(
        "multi_agent_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("agent_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=240), nullable=False),
        sa.Column("request", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["agent_id"], ["multi_agents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_multi_agent_tasks_agent_id", "multi_agent_tasks", ["agent_id"])
    op.create_index("ix_multi_agent_tasks_status", "multi_agent_tasks", ["status"])
    op.create_table(
        "multi_agent_nodes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("key", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=160), nullable=False),
        sa.Column("role", sa.String(length=500), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("position", sa.JSON(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=False),
        sa.Column("final_output", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["multi_agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_multi_agent_nodes_conversation_id", "multi_agent_nodes", ["conversation_id"]
    )
    op.create_index("ix_multi_agent_nodes_status", "multi_agent_nodes", ["status"])
    op.create_index("ix_multi_agent_nodes_task_id", "multi_agent_nodes", ["task_id"])
    op.create_table(
        "multi_agent_edges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("source_node_id", sa.Uuid(), nullable=False),
        sa.Column("target_node_id", sa.Uuid(), nullable=False),
        sa.ForeignKeyConstraint(["source_node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["multi_agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_multi_agent_edges_source_node_id", "multi_agent_edges", ["source_node_id"])
    op.create_index("ix_multi_agent_edges_target_node_id", "multi_agent_edges", ["target_node_id"])
    op.create_index("ix_multi_agent_edges_task_id", "multi_agent_edges", ["task_id"])
    op.create_table(
        "multi_agent_messages",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("from_node_id", sa.Uuid(), nullable=False),
        sa.Column("to_node_id", sa.Uuid(), nullable=False),
        sa.Column("message_type", sa.String(length=32), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("expects_reply", sa.Boolean(), nullable=False),
        sa.Column("reply_to_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["from_node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reply_to_id"], ["multi_agent_messages.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["task_id"], ["multi_agent_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["to_node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_multi_agent_messages_from_node_id", "multi_agent_messages", ["from_node_id"]
    )
    op.create_index("ix_multi_agent_messages_task_id", "multi_agent_messages", ["task_id"])
    op.create_index("ix_multi_agent_messages_to_node_id", "multi_agent_messages", ["to_node_id"])
    op.create_table(
        "workspace_changes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("task_id", sa.Uuid(), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("path", sa.String(length=2048), nullable=False),
        sa.Column("operation", sa.String(length=20), nullable=False),
        sa.Column("before_hash", sa.String(length=128), nullable=True),
        sa.Column("after_hash", sa.String(length=128), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["task_id"], ["multi_agent_tasks.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_workspace_changes_node_id", "workspace_changes", ["node_id"])
    op.create_index("ix_workspace_changes_task_id", "workspace_changes", ["task_id"])


def downgrade():
    op.drop_table("workspace_changes")
    op.drop_table("multi_agent_messages")
    op.drop_table("multi_agent_edges")
    op.drop_table("multi_agent_nodes")
    op.drop_table("multi_agent_tasks")
    op.drop_table("multi_agents")
    op.drop_index("ix_conversations_kind", table_name="conversations")
    op.drop_column("conversations", "kind")
    op.drop_index("ix_projects_kind", table_name="projects")
    op.drop_column("projects", "kind")
