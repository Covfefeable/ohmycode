import assert from "node:assert/strict";
import test from "node:test";
import { FollowupQueue, runToolLoop, forwardServerStream } from "../dist/index.js";

const input = (id) => ({ id, content: id, attachments: [], status: "queued" });
const queue = () => new FollowupQueue({ inputs: [], paused: false }, () => {});

test("按顺序独占预留，重复调度不会启动两次", () => {
  const q = queue(); q.add(input("a")); q.add(input("b"));
  assert.equal(q.reserve().id, "a"); assert.equal(q.reserve(), undefined);
  q.remove("a"); assert.equal(q.reserve().id, "b");
});

test("引导与撤销互斥；引导等待期间不自动发送", () => {
  const q = queue(); q.add(input("a")); q.steer("a");
  assert.throws(() => q.withdraw("a"), /input_not_queued/);
  assert.throws(() => q.steer("a"), /input_not_queued/);
  assert.equal(q.reserve(), undefined);
  q.remove("a"); assert.deepEqual(q.snapshot().inputs, []);
});

test("失败暂停保留消息，显式恢复后才允许发送", () => {
  const q = queue(); q.add(input("a")); q.pause();
  assert.equal(q.reserve(), undefined);
  q.resume(); assert.equal(q.reserve().id, "a");
  q.reset("a"); const withdrawn = q.withdraw("a");
  assert.equal(withdrawn.content, "a"); assert.equal(q.snapshot().inputs.length, 0);
});

test("快照和调用方对象不允许绕过队列修改状态", () => {
  const q = queue(); const value = input("a"); q.add(value); value.content = "changed";
  q.snapshot().inputs[0].content = "changed again";
  assert.equal(q.snapshot().inputs[0].content, "a");
});

const stream = (events) => new Response(events.map((e) => `id: ${e.id}\ndata: ${JSON.stringify(e.event)}\n\n`).join("") + "data: [DONE]\n\n");

test("没有工具调用时，引导边界仍继续同一个 Turn", async () => {
  let continued = 0;
  await runToolLoop({
    response: stream([{ id: "first:1", event: { type: "run.continue", runId: "run", executionId: "first" } }]),
    runId: "run", workspaceInstructions: "", tools: { execute() { assert.fail("No tool expected"); } },
    toolSnapshot: () => [], execution: { signal: new AbortController().signal }, onEvent() {},
    transport: { async continue(runId, executionId) { assert.equal(runId, "run"); assert.equal(executionId, "first"); continued++; return stream([]); } },
  });
  assert.equal(continued, 1);
});

test("重放去重不会丢失继续执行的控制信号", async () => {
  const events = [{ id: "first:1", event: { type: "run.continue", runId: "run", executionId: "first" } }];
  const seen = new Set(["first:1"]);
  let continuation;
  await forwardServerStream(stream(events), () => assert.fail("Duplicate UI event"), seen, (id) => { continuation = id; });
  assert.equal(continuation, "first");
});
