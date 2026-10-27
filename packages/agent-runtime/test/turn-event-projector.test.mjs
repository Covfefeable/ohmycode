import assert from "node:assert/strict";
import test from "node:test";
import { TurnEventProjector } from "../dist/index.js";

test("思考、正文和工具按顺序投影，历史事件不随状态修改", () => {
  const projector = new TurnEventProjector("thread", "turn");
  projector.project({ type: "task.plan.updated", tasks: [{ id: "task", content: "Read", status: "in_progress" }] });
  const [started] = projector.project({ type: "reasoning.started", stepId: "reasoning" });
  assert.equal(started.item.taskId, "task");
  projector.project({ type: "reasoning.delta", content: "Thinking" });
  const requested = projector.project({ type: "tool.requested", runId: "turn", callId: "tool", tool: "read_file", arguments: { path: "a" } });
  assert.equal(requested[0].item.content, "Thinking");
  assert.equal(requested[1].item.kind, "tool");
  assert.equal(requested[1].item.taskId, "task");
  assert.equal(started.item.status, "in_progress");
  assert.equal(started.item.content, "");
  const [completed] = projector.project({ type: "tool.completed", callId: "tool", result: { output: "read" } });
  assert.equal(completed.item.status, "completed");
  assert.deepEqual(completed.item.output, { output: "read" });
  assert.equal(requested[1].item.status, "in_progress");
  projector.project({ type: "message.started" });
  projector.project({ type: "message.delta", content: "Done" });
  const finished = projector.finish();
  assert.equal(finished.length, 1);
  assert.equal(finished[0].item.content, "Done");
  assert.deepEqual(projector.finish(), []);
});

test("引导输入结束上一段正文，保留附件且不结束进行中的工具", () => {
  const projector = new TurnEventProjector("thread", "turn");
  const initial = projector.userMessage("user", "Start", [], true);
  assert.equal(initial.item.input.initial, true);
  projector.project({ type: "message.started" });
  projector.project({ type: "message.delta", content: "Progress" });
  const attachments = [{ id: "a", name: "a.txt", path: "/a.txt", size: 1, mimeType: "text/plain" }];
  const events = projector.project({ type: "input.received", inputId: "input", messageId: "user-next", content: "Change", attachments, createdAt: "2026-10-28" });
  assert.equal(events[0].item.kind, "agent_message");
  assert.equal(events[0].item.content, "Progress");
  assert.equal(events[1].item.kind, "user_message");
  assert.deepEqual(events[1].item.input, { attachments, initial: false });
  projector.project({ type: "tool.requested", runId: "turn", callId: "tool", tool: "read_file", arguments: {} });
  assert.deepEqual(projector.project({ type: "run.continue", runId: "turn", executionId: "next" }), []);
  assert.equal(projector.finish()[0].item.kind, "tool");
});

test("压缩、usage 和失败使用统一事件，轮次之间不共享 Item 或任务状态", () => {
  const first = new TurnEventProjector("thread", "first");
  const second = new TurnEventProjector("thread", "second");
  first.project({ type: "reasoning.started", stepId: "same-id" });
  assert.deepEqual(second.project({ type: "reasoning.delta", content: "ignored" }), []);
  assert.deepEqual(second.finish(), []);
  const [started] = second.project({ type: "context.compaction.started", estimatedTokens: 10, contextLength: 20 });
  assert.equal(started.item.kind, "context");
  const [completed] = second.project({ type: "context.compaction.completed", estimatedTokens: 5, contextLength: 20 });
  assert.equal(completed.item.status, "completed");
  assert.equal(started.item.status, "in_progress");
  assert.deepEqual(second.project({ type: "context.usage", usedTokens: 5, contextLength: 20, source: "provider" }), [
    { type: "context.updated", threadId: "thread", turnId: "second", usedTokens: 5, contextLength: 20, source: "provider" },
  ]);
  assert.deepEqual(second.project({ type: "run.failed", errorCode: "provider_error" }), [
    { type: "turn.failed", threadId: "thread", turnId: "second", errorCode: "provider_error" },
  ]);
});
