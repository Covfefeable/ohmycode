from pathlib import Path

Path("records.txt").write_text(
    "".join(
        f"{index}: {'violet-orbit' if index == 2500 else 'ordinary-record'}\n"
        for index in range(1, 5001)
    ),
    encoding="utf-8",
)
