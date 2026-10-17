import assert from "node:assert/strict";
import test from "node:test";
import { forwardServerStream } from "../dist/index.js";

const encoder = new TextEncoder();

function response(chunks, { close = true, onCancel = () => {} } = {}) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (close) controller.close();
    },
    cancel: onCancel,
  }));
}

test("中文、CRLF 和 JSON 在任意字节位置分包仍能恢复", async () => {
  const frame = encoder.encode('id: request:1\r\ndata: {"type":"message.delta","content":"你好 🌱"}\r\n\r\ndata: [DONE]\r\n\r\n');
  for (let split = 1; split < frame.length; split += 1) {
    const events = [];
    await forwardServerStream(response([frame.slice(0, split), frame.slice(split)]), (event) => events.push(event));
    assert.deepEqual(events, [{ type: "message.delta", content: "你好 🌱" }]);
  }
});

test("收到 DONE 即结束，不等待服务端关闭连接，并释放 reader", { timeout: 1000 }, async () => {
  let cancelled = false;
  const source = response([encoder.encode("data: [DONE]\n\n")], {
    close: false,
    onCancel: () => { cancelled = true; },
  });
  await forwardServerStream(source, () => assert.fail("unexpected event"));
  assert.equal(cancelled, true);
  assert.equal(source.body.locked, false);
});

test("渲染回调失败不应确认该事件，重放仍可再次交付", async () => {
  const seen = new Set();
  const frame = encoder.encode('id: request:1\ndata: {"type":"message.delta","content":"partial"}\n\ndata: [DONE]\n\n');
  const source = response([frame]);
  await assert.rejects(forwardServerStream(source, () => { throw new Error("consumer_failed"); }, seen), /consumer_failed/);
  assert.equal(source.body.locked, false);
  const events = [];
  await forwardServerStream(response([frame]), (event) => events.push(event), seen);
  assert.equal(events.length, 1);
});

test("错误的 JSON 会报错并关闭仍在传输的连接", async () => {
  let cancelled = false;
  const source = response([encoder.encode("data: invalid\n\n")], {
    close: false,
    onCancel: () => { cancelled = true; },
  });
  await assert.rejects(forwardServerStream(source, () => {}), SyntaxError);
  assert.equal(cancelled, true);
  assert.equal(source.body.locked, false);
});

test("协议结束之后的内容不再交付", async () => {
  const events = [];
  await forwardServerStream(response([encoder.encode('data: [DONE]\n\ndata: {"type":"message.delta","content":"late"}\n\n')]), (event) => events.push(event));
  assert.deepEqual(events, []);
});

test("重复订阅只交付一次 UI 事件，但保留完整工具批次", async () => {
  const frame = encoder.encode(': heartbeat\n\nid: step:1\ndata: {"type":"tool.requested","runId":"turn","callId":"a","tool":"read_file","arguments":{}}\n\nid: step:2\ndata: {"type":"tool.requested","runId":"turn","callId":"b","tool":"read_file","arguments":{}}\n\ndata: [DONE]\n\n');
  const events = [], seen = new Set();
  for (let reconnect = 0; reconnect < 3; reconnect += 1) {
    const tools = await forwardServerStream(response([frame]), (event) => events.push(event), seen);
    assert.deepEqual(tools.map((tool) => tool.callId), ["a", "b"]);
  }
  assert.deepEqual(events.map((event) => event.callId), ["a", "b"]);
});
