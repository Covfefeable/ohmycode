import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout } from "node:timers/promises";
import { prepareWait } from "../dist/page-wait.js";
import { PageSession } from "../dist/page-session.js";

test("wait conditions validate their inputs and encode text rather than executing it", () => {
  const value = "'); throw new Error('injected'); //";
  assert.equal(prepareWait({ condition: "text", text: value }).expression, `(document.body?.innerText ?? '').includes(${JSON.stringify(value)})`);
  assert.equal(prepareWait({ condition: "selector", selector: "#ready", state: "hidden" }).expression.startsWith("!("), true);
  for (const timeoutMs of [-1, 0, 30_001, 1.5]) assert.throws(() => prepareWait({ condition: "text", text: "ready", timeoutMs }), /browser_invalid_wait_timeout/);
  assert.throws(() => prepareWait({ condition: "unknown" }), /browser_wait_condition_required/);
  assert.throws(() => prepareWait({ condition: "url", url: "ready", state: "hidden" }), /browser_url_wait_requires_visible_state/);
});

test("wait timeout and user cancellation stop polling without retrying an action", async () => {
  let evaluations = 0;
  const session = new PageSession({ debugger: { async sendCommand(method) { if (method === "Runtime.evaluate") evaluations++; return { result: { value: false } }; } } });
  const result = await session.wait({ condition: "text", text: "missing", timeoutMs: 20 });
  assert.equal(result.matched, false);
  assert.equal(result.reason, "timeout");
  const count = evaluations;
  await setTimeout(120);
  assert.equal(evaluations, count);
  const abort = new AbortController();
  const pending = session.wait({ condition: "text", text: "missing" }, abort.signal);
  abort.abort(new Error("user stopped"));
  await assert.rejects(pending, /user stopped/);
  const stopped = evaluations;
  await setTimeout(120);
  assert.equal(evaluations, stopped);
});
