"""add collaboration hosts

Revision ID: k92cg687ei06
Revises: j81bf576dh95
"""

import json
import uuid

import sqlalchemy as sa
from alembic import op

revision = "k92cg687ei06"
down_revision = "j81bf576dh95"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("multi_agent_nodes") as batch_op:
        batch_op.add_column(
            sa.Column("is_host", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        batch_op.create_index("ix_multi_agent_nodes_is_host", ["is_host"])
    op.execute("""
        UPDATE multi_agent_nodes AS node SET is_host = true
        WHERE node.id IN (
            SELECT DISTINCT ON (task_id) id FROM multi_agent_nodes
            ORDER BY task_id, sort_order, id
        )
    """)
    connection = op.get_bind()
    for agent_id, raw_template in connection.execute(
        sa.text("SELECT id, template_flow FROM multi_agents")
    ):
        template = (
            raw_template if isinstance(raw_template, dict) else json.loads(raw_template or "{}")
        )
        if isinstance(template.get("members"), list):
            continue
        members = [
            item
            for item in template.get("nodes", [])
            if item.get("key") not in {"workflow_start", "workflow_end"}
        ]
        members.insert(
            0,
            {
                "key": "host",
                "name": "主持人",
                "role": "协作主持人",
                "instructions": "理解用户目标，调度合适的角色逐步推进，并在目标完成时结束协作。",
                "isHost": True,
                "modelId": None,
                "sortOrder": 0,
            },
        )
        for index, member in enumerate(members[1:], 1):
            member.pop("position", None)
            member["isHost"] = False
            member["sortOrder"] = index
        connection.execute(
            sa.text("UPDATE multi_agents SET template_flow=:template WHERE id=:id"),
            {
                "id": agent_id,
                "template": json.dumps(
                    {"title": template.get("title") or "Collaboration", "members": members}
                ),
            },
        )
    connection.execute(
        sa.text("UPDATE multi_agent_tasks SET status='stopped' WHERE status='running'")
    )
    connection.execute(sa.text("UPDATE multi_agent_nodes SET status='idle'"))
    for task_id, request, host_id in connection.execute(
        sa.text("""
        SELECT task.id, task.request, node.id FROM multi_agent_tasks task
        JOIN multi_agent_nodes node ON node.task_id=task.id AND node.is_host=true
        WHERE NOT EXISTS (
            SELECT 1 FROM multi_agent_messages message
            WHERE message.task_id=task.id AND message.sender_type='user'
        )
    """)
    ):
        connection.execute(
            sa.text("""
            INSERT INTO multi_agent_messages (
                id,task_id,from_node_id,to_node_id,message_type,sender_type,content,expects_reply
            )
            VALUES (:id,:task_id,NULL,:host_id,'brief','user',:content,false)
        """),
            {
                "id": uuid.uuid4(),
                "task_id": task_id,
                "host_id": host_id,
                "content": request,
            },
        )
    op.drop_table("multi_agent_edges")
    with op.batch_alter_table("multi_agent_nodes") as batch_op:
        batch_op.drop_column("position")


def downgrade():
    with op.batch_alter_table("multi_agent_nodes") as batch_op:
        batch_op.add_column(sa.Column("position", sa.JSON(), nullable=False, server_default="{}"))
        batch_op.drop_index("ix_multi_agent_nodes_is_host")
        batch_op.drop_column("is_host")
    op.create_table(
        "multi_agent_edges",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("task_id", sa.UUID(), nullable=False),
        sa.Column("source_node_id", sa.UUID(), nullable=False),
        sa.Column("target_node_id", sa.UUID(), nullable=False),
        sa.ForeignKeyConstraint(["task_id"], ["multi_agent_tasks.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["target_node_id"], ["multi_agent_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_multi_agent_edges_task_id", "multi_agent_edges", ["task_id"])
    op.create_index("ix_multi_agent_edges_source_node_id", "multi_agent_edges", ["source_node_id"])
    op.create_index("ix_multi_agent_edges_target_node_id", "multi_agent_edges", ["target_node_id"])
