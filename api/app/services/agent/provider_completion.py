"""Assemble OpenAI-compatible provider deltas without persistence or transport I/O."""

from collections.abc import Iterator
from dataclasses import dataclass, field


@dataclass
class CompletionAccumulator:
    answer: str = ""
    reasoning: str = ""
    tool_calls: dict[int, dict] = field(default_factory=dict)
    input_tokens: int | None = None
    output_tokens: int | None = None
    _reasoning_started: bool = False
    _message_started: bool = False

    def consume(self, payload: dict, reasoning_id: str) -> Iterator[dict]:
        usage = payload.get("usage") or {}
        input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
        output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
        if input_tokens is not None:
            self.input_tokens = int(input_tokens)
        if output_tokens is not None:
            self.output_tokens = int(output_tokens)
        choice = (payload.get("choices") or [{}])[0]
        delta = choice.get("delta") or {}
        for tool_delta in delta.get("tool_calls") or []:
            index = int(tool_delta.get("index", 0))
            current = self.tool_calls.setdefault(
                index,
                {
                    "id": "",
                    "type": "function",
                    "function": {"name": "", "arguments": ""},
                },
            )
            if tool_delta.get("id"):
                current["id"] = tool_delta["id"]
            function_delta = tool_delta.get("function") or {}
            current["function"]["name"] += function_delta.get("name") or ""
            current["function"]["arguments"] += function_delta.get("arguments") or ""
        reasoning_chunk = delta.get("reasoning_content") or delta.get("reasoning")
        if reasoning_chunk:
            if not self._reasoning_started:
                self._reasoning_started = True
                yield {
                    "type": "reasoning.started",
                    "stepId": reasoning_id,
                }
            self.reasoning += reasoning_chunk
            yield {"type": "reasoning.delta", "content": reasoning_chunk}
        chunk = delta.get("content") or choice.get("text")
        if not chunk and choice.get("message"):
            chunk = choice["message"].get("content")
        if chunk:
            if not self._message_started:
                self._message_started = True
                yield {"type": "message.started"}
            self.answer += chunk
            yield {"type": "message.delta", "content": chunk}
