import assert from "node:assert/strict";
import test from "node:test";
import { runToolLoop } from "../dist/index.js";

const frame = (id, event) => `id: ${id}\ndata: ${JSON.stringify(event)}\n\n`;
const stream = (body, done = true) => new Response(body + (done ? "data: [DONE]\n\n" : ""));
const options = (overrides = {}) => ({
  runId: "turn", workspaceInstructions: "", toolSnapshot: () => [],
  execution: { signal: new AbortController().signal },
  tools: { execute() { assert.fail("Unexpected tool call"); } },
  onEvent() {}, ...overrides,
});

test("连接意外结束后重放已有片段，不重复文字并继续后续输出", async () => {
  const partial = frame("step:1", { type: "message.delta", content: "Hello " });
  const events = [];
  let recovered = 0;
  await runToolLoop(options({
    response: stream(partial, false), onEvent: (event) => events.push(event),
    transport: { async recover(runId, _instructions, results) {
      assert.equal(runId, "turn"); assert.deepEqual(results, []); recovered++;
      return stream(partial + frame("step:2", { type: "message.delta", content: "world" }));
    } },
  }));
  assert.equal(recovered, 1);
  assert.equal(events.map((event) => event.content).join(""), "Hello world");
});

test("提交工具结果时断网，重连携带原结果且不重新执行工具", async () => {
  const result = { callId: "read", result: { content: "file contents" } };
  let executed = 0, resumed = 0, recovered = 0;
  await runToolLoop(options({
    response: stream(frame("step:1", { type: "tool.requested", runId: "turn", callId: "read", tool: "read_file", arguments: {} })),
    tools: { async execute() { executed++; return result; } },
    transport: {
      async resume(_runId, results) { resumed++; assert.deepEqual(results, [result]); throw new Error("socket_closed"); },
      async recover(_runId, _instructions, results) { recovered++; assert.deepEqual(results, [result]); return stream(""); },
    },
  }));
  assert.deepEqual([executed, resumed, recovered], [1, 1, 1]);
});

test("重连退避期间停止，不再发起恢复请求", async () => {
  const controller = new AbortController();
  const stopped = new Error("user_stopped");
  const pending = runToolLoop(options({
    response: stream("", false), execution: { signal: controller.signal },
    transport: { recover() { assert.fail("Stopped task must not reconnect"); } },
  }));
  const rejected = assert.rejects(pending, (error) => error === stopped);
  // Finish the initial reader's microtasks; no wall-clock delay is required.
  await new Promise(setImmediate);
  controller.abort(stopped);
  await rejected;
});

test("服务商明确返回失败时保留错误，不当作断网反复重连", async () => {
  const events = [];
  await runToolLoop(options({
    response: stream(frame("step:1", { type: "run.failed", errorCode: "provider_failed" })),
    onEvent: (event) => events.push(event),
    transport: { recover() { assert.fail("Provider failure is already terminal"); } },
  }));
  assert.deepEqual(events, [{ type: "run.failed", errorCode: "provider_failed" }]);
});
