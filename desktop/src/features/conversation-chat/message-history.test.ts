import { expect, test } from "vitest";
import { mergeTurnMessages } from "./message-history";

const message = (id: string, content = id): LocalMessage => ({ id, role: "assistant", content, createdAt: "2026-10-18T00:00:00Z" });

test("完成回显只替换自己的流式占位，保留历史和下一轮", () => {
  const current = [message("history"), message("user"), message("stream-old"), message("next-user"), message("stream-new")];
  expect(mergeTurnMessages(current, [message("answer")], "old").map((item) => item.id))
    .toEqual(["history", "user", "answer", "next-user", "stream-new"]);
});

test("已存在的用户消息不会因回显重复插入", () => {
  const user = { ...message("user"), role: "user" as const };
  expect(mergeTurnMessages([user, message("stream-turn")], [user, message("answer")], "turn").map((item) => item.id))
    .toEqual(["user", "answer"]);
});

test("失败且没有保存的回答时保留已经输出的部分", () => {
  const current = [message("user-turn"), message("stream-turn", "Partial answer")];
  expect(mergeTurnMessages(current, [], "turn")).toEqual(current);
});
