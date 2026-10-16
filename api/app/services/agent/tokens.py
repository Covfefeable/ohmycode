import json
import math


def estimate_tokens(text: str) -> int:
    ascii_count = sum(character.isascii() for character in text)
    return max(1, math.ceil(ascii_count / 4) + len(text) - ascii_count)


def request_tokens(messages: list[dict], tools: list[dict]) -> int:
    return estimate_tokens(json.dumps({"messages": messages, "tools": tools}, ensure_ascii=False))
