import assert from "node:assert/strict";
import test from "node:test";
import { TurnExecution } from "../dist/index.js";

test("failed cancellation survives completion and can be retried after restore", async () => {
  const states = new Map();
  const store = {
    saveExecution: (state) => states.set(state.turnId, state),
    deleteExecution: (id) => states.delete(id),
    loadExecutions: () => [...states.values()],
  };
  let offline = true;
  const received = [];
  const adapter = {
    stopResource: async () => {},
    cancelRemoteRun: async (_id, partial) => {
      if (offline) throw new Error("offline");
      received.push(partial);
    },
    isMissingRemoteRunError: () => false,
  };
  const execution = new TurnExecution("turn", adapter, store);
  await assert.rejects(execution.interrupt({ content: "partial" }), /remote_cancellation_pending/);
  execution.complete();
  assert.equal(states.get("turn").cancellationPending, true);
  assert.equal(execution.signal.aborted, true);
  offline = false;
  const restored = TurnExecution.restore(states.get("turn"), adapter, store);
  await restored.interrupt();
  assert.deepEqual(received, [{ content: "partial" }]);
  assert.equal(states.size, 0);
});

test("an already missing remote run completes cancellation without retrying", async () => {
  let attempts = 0;
  let deleted = false;
  const execution = new TurnExecution("gone", {
    stopResource: async () => {},
    cancelRemoteRun: async () => { attempts += 1; throw new Error("missing"); },
    isMissingRemoteRunError: () => true,
  }, {
    saveExecution: () => {}, loadExecutions: () => [],
    deleteExecution: () => { deleted = true; },
  });
  await execution.interrupt();
  assert.equal(attempts, 1);
  assert.equal(deleted, true);
});
