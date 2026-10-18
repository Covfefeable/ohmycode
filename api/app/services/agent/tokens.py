import json
import math

from .image_context import image_tokens


def estimate_tokens(text: str) -> int:
    ascii_count = sum(character.isascii() for character in text)
    return max(1, math.ceil(ascii_count / 4) + len(text) - ascii_count)


def request_tokens(messages: list[dict], tools: list[dict]) -> int:
    visual_tokens = 0
    text_messages = []
    for message in messages:
        content = message.get("content")
        if isinstance(content, list):
            text_parts = []
            for part in content:
                if part.get("type") == "image_url":
                    visual_tokens += image_tokens(part["image_url"])
                else:
                    text_parts.append(part)
            message = {**message, "content": text_parts}
        text_messages.append(message)
    return visual_tokens + estimate_tokens(
        json.dumps({"messages": text_messages, "tools": tools}, ensure_ascii=False)
    )
