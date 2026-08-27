import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventJournal } from "@ohmycode/runtime-core";
import { SqliteEventStore } from "../../dist-electron/runtime/sqlite-event-store.js";

const directory = await mkdtemp(join(tmpdir(), "ohmycode-runtime-"));
const databasePath = join(directory, "events.sqlite");

try {
  const first = new EventJournal(new SqliteEventStore(databasePath));
  first.create("thread-1", "turn-1");
  first.append("turn-1", { type: "turn.started", threadId: "thread-1", turnId: "turn-1" });
  first.close();

  const restored = new EventJournal(new SqliteEventStore(databasePath));
  assert.equal(restored.snapshotForThread("thread-1")?.status, "in_progress");
  assert.equal(restored.snapshot("turn-1")?.events.length, 1);
  restored.append("turn-1", {
    type: "turn.interrupted",
    threadId: "thread-1",
    turnId: "turn-1",
    reason: "runtime_restarted",
  });
  restored.close();

  const final = new EventJournal(new SqliteEventStore(databasePath));
  assert.equal(final.snapshot("turn-1")?.status, "interrupted");
  assert.equal(final.snapshot("turn-1", 1)?.events[0]?.sequence, 2);
  final.close();
} finally {
  await rm(directory, { recursive: true, force: true });
}
