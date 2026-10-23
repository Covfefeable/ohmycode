import assert from "node:assert/strict";
import test from "node:test";
import { ConsoleDiagnostics } from "../dist/console-diagnostics.js";

const log = (console, value, type = "log") => console.handle("Runtime.consoleAPICalled", { type, timestamp: 1000, args: [{ type: "string", value }], stackTrace: { callFrames: [{ url: "https://example.com/app.js?token=fixture-secret", lineNumber: 9, columnNumber: 2 }] } });

test("console filtering and pagination advance a stable cursor and report eviction gaps", () => {
  const console = new ConsoleDiagnostics();
  for (let index = 0; index < 505; index++) log(console, String(index), index % 2 ? "error" : "warning");
  const first = console.read({ limit: 2, level: "error" });
  assert.equal(first.entries.length, 2);
  assert.equal(first.dropped, true);
  assert.equal(first.entries[0].sequence, 6);
  assert.equal(first.hasMore, true);
  const second = console.read({ after: first.nextCursor, level: "error" });
  assert.equal(second.entries[0].sequence > first.nextCursor, true);
  assert.equal(second.entries[0].line, 10);
  assert.equal(JSON.stringify(second).includes("fixture-secret"), false);
  const last = console.read({ after: 505 });
  assert.equal(last.entries.length, 0);
  assert.equal(last.nextCursor, 505);
  assert.equal(last.hasMore, false);
  assert.throws(() => console.read({ after: -1 }), /browser_invalid_console_cursor/);
  assert.throws(() => console.read({ limit: 0 }), /browser_invalid_limit/);
});

test("remote objects and exception messages are bounded, without reading live object properties", () => {
  const console = new ConsoleDiagnostics();
  console.handle("Runtime.consoleAPICalled", { type: "log", timestamp: 1000, args: [{ type: "object", objectId: "must-not-be-dereferenced", preview: { description: "Object", overflow: true, properties: Array.from({ length: 50 }, () => ({ name: "field", value: "x".repeat(5000), type: "string" })) } }] });
  console.handle("Runtime.exceptionThrown", { timestamp: 1001, exceptionDetails: { text: "Uncaught", lineNumber: 0, columnNumber: 0, exception: { type: "object", description: "Error: fixture failure" } } });
  const { entries } = console.read({});
  assert.equal(entries[0].text.length <= 2000, true);
  assert.equal(entries[0].text.includes("…"), true);
  assert.equal(entries[1].kind, "exception");
  assert.equal(entries[1].level, "error");
  assert.equal(entries[1].text, "Error: fixture failure");
});
