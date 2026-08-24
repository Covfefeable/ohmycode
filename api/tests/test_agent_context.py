from app.services.agent.context import COMPACTION_RATIO, estimate_tokens


def test_context_defaults_and_multilingual_token_estimate():
    assert COMPACTION_RATIO == 0.70
    assert estimate_tokens("a" * 400) == 100
    assert estimate_tokens("你好世界") == 4
