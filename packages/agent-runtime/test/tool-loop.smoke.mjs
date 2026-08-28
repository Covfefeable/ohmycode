import assert from "node:assert/strict";
import { ReadableStream } from "node:stream/web";
import { TextEncoder } from "node:util";
import { runToolLoop } from "../dist/index.js";

const { AbortController, setTimeout } = globalThis;

const encoder = new TextEncoder();
const response = (body) => ({
  body: new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(body));
      controller.close();
    },
  }),
});
const complete = () => response("data: [DONE]\n\n");
const toolSnapshot = () => [];

const recovered = [];
const recoveryEvents = [];
await runToolLoop({
  response: response([
    'data: {"type":"message.started"}\n\n',
    'data: {"type":"message.delta","content":"partial"}\n\n',
  ].join("")),
  runId: "run-1",
  workspaceInstructions: "rules",
  transport: {
    recover: async (...args) => {
      recovered.push(args);
      return complete();
    },
  },
  tools: { execute: async () => { throw new Error("unexpected tool"); } },
  execution: {
    signal: new AbortController().signal,
    setPhase: () => undefined,
    setPendingToolCalls: () => undefined,
  },
  onEvent: (event) => recoveryEvents.push(event),
  toolSnapshot,
});
assert.equal(recovered.length, 1);
assert.equal(recovered[0][2], "partial");
assert.deepEqual(recoveryEvents.map((event) => event.type), ["message.started", "message.delta"]);

let active = 0;
let maximumActive = 0;
const executed = [];
const resumed = [];
await runToolLoop({
  response: response([
    'data: {"type":"tool.requested","runId":"run-2","callId":"a","tool":"one","arguments":{}}\n\n',
    'data: {"type":"tool.requested","runId":"run-2","callId":"b","tool":"two","arguments":{}}\n\n',
    "data: [DONE]\n\n",
  ].join("")),
  runId: "run-2",
  workspaceInstructions: "",
  transport: {
    resume: async (_runId, results) => {
      resumed.push(results);
      return response("data: [DONE]\n\n");
    },
  },
  tools: {
    execute: async (request) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      executed.push(request.callId);
      return { callId: request.callId, result: { ok: true } };
    },
  },
  execution: {
    signal: new AbortController().signal,
    setPhase: () => undefined,
    setPendingToolCalls: () => undefined,
  },
  onEvent: () => undefined,
  toolSnapshot,
});
assert.equal(maximumActive, 2);
assert.deepEqual(executed.sort(), ["a", "b"]);
assert.equal(resumed[0].length, 2);

let sideEffectCount = 0;
const recoveredResults = [];
await runToolLoop({
  response: response([
    'data: {"type":"tool.requested","runId":"run-3","callId":"write-1","tool":"apply_patch","arguments":{}}\n\n',
    "data: [DONE]\n\n",
  ].join("")),
  runId: "run-3",
  workspaceInstructions: "",
  transport: {
    resume: async () => { throw new TypeError("connection closed before response"); },
    recover: async (_runId, _instructions, _content, _reasoning, results) => {
      recoveredResults.push(results);
      return complete();
    },
  },
  tools: {
    execute: async (request) => {
      sideEffectCount += 1;
      return { callId: request.callId, result: { changed: true } };
    },
  },
  execution: {
    signal: new AbortController().signal,
    setPhase: () => undefined,
    setPendingToolCalls: () => undefined,
  },
  onEvent: () => undefined,
  toolSnapshot,
});
assert.equal(sideEffectCount, 1);
assert.deepEqual(recoveredResults[0], [
  { callId: "write-1", result: { changed: true } },
]);
