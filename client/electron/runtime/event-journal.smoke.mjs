import assert from "node:assert/strict";
import { EventJournal } from "../../dist-electron/runtime/event-journal.js";

const journal = new EventJournal();
journal.create("thread-1", "turn-1");
const started = journal.append("turn-1", {
  type: "turn.started",
  threadId: "thread-1",
  turnId: "turn-1",
});
const item = {
  id: "item-1",
  threadId: "thread-1",
  turnId: "turn-1",
  kind: "agent_message",
  status: "in_progress",
  content: "",
};
journal.append("turn-1", { type: "item.started", threadId: "thread-1", turnId: "turn-1", item });
journal.append("turn-1", { type: "item.delta", threadId: "thread-1", turnId: "turn-1", itemId: item.id, delta: "hello" });
journal.append("turn-1", { type: "turn.completed", threadId: "thread-1", turnId: "turn-1" });

assert.equal(started.sequence, 1);
assert.equal(journal.snapshotForThread("thread-1")?.status, "completed");
assert.deepEqual(journal.snapshot("turn-1", 2)?.events.map((event) => event.sequence), [3, 4]);
