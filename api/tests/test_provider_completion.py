from app.services.agent.provider_completion import CompletionAccumulator


def test_interleaved_tool_fragments_preserve_each_call_and_stream_order():
    completion = CompletionAccumulator()
    events = list(
        completion.consume(
            {
                "choices": [
                    {
                        "delta": {
                            "reasoning_content": "inspect",
                            "content": "checking",
                            "tool_calls": [
                                {
                                    "index": 1,
                                    "id": "b",
                                    "function": {"name": "read_", "arguments": '{"path":'},
                                },
                                {
                                    "index": 0,
                                    "id": "a",
                                    "function": {"name": "list_directory", "arguments": "{}"},
                                },
                            ],
                        }
                    }
                ]
            },
            "reasoning-1",
        )
    )
    events += list(
        completion.consume(
            {
                "choices": [
                    {
                        "delta": {
                            "tool_calls": [
                                {"index": 1, "function": {"name": "file", "arguments": '"a.py"}'}}
                            ],
                            "content": " now",
                        }
                    }
                ]
            },
            "reasoning-1",
        )
    )
    assert [event["type"] for event in events] == [
        "reasoning.started",
        "reasoning.delta",
        "message.started",
        "message.delta",
        "message.delta",
    ]
    assert completion.answer == "checking now"
    assert completion.tool_calls[1] == {
        "id": "b",
        "type": "function",
        "function": {"name": "read_file", "arguments": '{"path":"a.py"}'},
    }
    assert completion.tool_calls[0]["id"] == "a"


def test_usage_only_payload_preserves_zero_and_missing_usage_does_not_reset_it():
    completion = CompletionAccumulator()
    assert (
        list(
            completion.consume(
                {"choices": [], "usage": {"prompt_tokens": 0, "completion_tokens": 12}}, "r"
            )
        )
        == []
    )
    list(completion.consume({"choices": [{"message": {"content": "answer"}}]}, "r"))
    assert (completion.input_tokens, completion.output_tokens) == (0, 12)
    assert completion.answer == "answer"
