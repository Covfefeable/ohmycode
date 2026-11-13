import json

import pytest

from app.extensions import db
from app.models import AgentRun, Conversation, Message
from app.services.agent.tool_results import read_tool_result, search_tool_result
from app.services.errors import ServiceError


def test_branch_result_lookup_after_source_deletion_preserves_device_scope(workspace):
    w = workspace
    with w.app.app_context():
        source = db.session.get(Conversation, w.conversation)
        run = AgentRun(conversation_id=source.id)
        db.session.add(run)
        db.session.flush()
        run_id = run.id
        events = [
            {
                "sequence": 1,
                "type": "tool.output",
                "payload": {
                    "results": [
                        {"callId": "evidence", "result": {"output": "independent evidence"}}
                    ],
                },
            }
        ]
        branch = Conversation(project_id=source.project_id)
        branch.messages = [
            Message(
                role="assistant",
                content="Done",
                context_snapshot=[
                    {
                        "role": "system",
                        "content": f"Complete AgentEvent history for completed turn {run_id}:\n"
                        + json.dumps(events),
                    }
                ],
            )
        ]
        db.session.add(branch)
        db.session.commit()
        db.session.delete(source)
        db.session.commit()
        assert db.session.get(AgentRun, run_id) is None
        assert (
            read_tool_result(w.user, run_id, "evidence", device_id="test")["content"]
            == "independent evidence"
        )
        assert search_tool_result(w.user, run_id, "evidence", "independent", device_id="test")[
            "matches"
        ]
        for scope in ({"device_id": "other-device"}, {"project_kind": "mobile"}):
            with pytest.raises(ServiceError) as error:
                read_tool_result(w.user, run_id, "evidence", **scope)
            assert error.value.code == "not_found"
