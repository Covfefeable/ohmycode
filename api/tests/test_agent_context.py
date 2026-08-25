from app.services.agent.chat import _sse_json_payloads
from app.services.agent.context import COMPACTION_RATIO, estimate_tokens


def test_context_defaults_and_multilingual_token_estimate():
    assert COMPACTION_RATIO == 0.70
    assert estimate_tokens("a" * 400) == 100
    assert estimate_tokens("你好世界") == 4


def test_sse_parser_ignores_control_fields_and_supports_multiline_data():
    lines = [
        ": keep-alive",
        "event: message",
        "id: 1",
        "data: {",
        'data: "choices": []',
        "data: }",
        "",
        "event: done",
        "data: [DONE]",
        "",
    ]

    assert list(_sse_json_payloads(lines)) == [{"choices": []}]
