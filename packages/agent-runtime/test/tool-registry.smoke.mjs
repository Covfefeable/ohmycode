import assert from "node:assert/strict";
import { CapabilityPlugin, defineToolPlugin, ToolRegistry, ToolResultReaderPlugin } from "../dist/index.js";

const calls = [];
let closed = false;
const registry = new ToolRegistry();
registry.register(new CapabilityPlugin({
  search: async (query) => {
    calls.push(["search", query]);
    return { results: [] };
  },
  load: async (id) => {
    calls.push(["load", id]);
    return { id };
  },
}));
registry.register(new ToolResultReaderPlugin({
  read: async (runId, callId, options) => ({ runId, callId, ...options }),
  search: async (runId, callId, query, options) => ({ runId, callId, query, ...options }),
}));
registry.register(defineToolPlugin({
  id: "echo",
  definitions: [{ name: "echo", description: "Echo input", inputSchema: { type: "object" } }],
  execute: (call) => call.arguments,
}));
registry.register({
  id: "dynamic",
  definitions: () => [],
  handles: (name) => name.startsWith("dynamic__"),
  execute: async (call) => ({ callId: call.callId, result: call.arguments }),
  close: async () => { closed = true; },
});

assert.deepEqual(registry.definitions().map((item) => item.name), [
  "search_capabilities",
  "load_capability",
  "read_tool_result",
  "search_tool_result",
  "echo",
]);
assert.deepEqual(
  await registry.execute({ runId: "run", callId: "echo", tool: "echo", arguments: { text: "hello" } }),
  { callId: "echo", result: { text: "hello" } },
);
assert.deepEqual(
  await registry.execute({ runId: "run", callId: "one", tool: "search_capabilities", arguments: { query: "mail" } }),
  { callId: "one", result: { results: [] } },
);
assert.deepEqual(
  await registry.execute({ runId: "run", callId: "read", tool: "read_tool_result", arguments: { callId: "source", cursor: 12 } }),
  { callId: "read", result: { runId: "run", callId: "source", cursor: 12, maxTokens: undefined } },
);
assert.deepEqual(
  await registry.execute({ runId: "run", callId: "two", tool: "dynamic__echo", arguments: { ok: true } }),
  { callId: "two", result: { ok: true } },
);
assert.deepEqual(calls, [["search", "mail"]]);
await assert.rejects(
  registry.execute({ runId: "run", callId: "three", tool: "missing", arguments: {} }),
  /unknown_tool:missing/,
);
await registry.close();
assert.equal(closed, true);

const duplicate = new ToolRegistry();
duplicate.register(new CapabilityPlugin({ search: async () => null, load: async () => null }));
assert.throws(
  () => duplicate.register(new CapabilityPlugin({ search: async () => null, load: async () => null })),
  /tool_plugin_already_registered:capabilities/,
);
