import assert from "node:assert/strict";
import { CapabilityPlugin, ToolRegistry } from "../dist/index.js";

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
]);
assert.deepEqual(
  await registry.execute({ runId: "run", callId: "one", tool: "search_capabilities", arguments: { query: "mail" } }),
  { callId: "one", result: { results: [] } },
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
