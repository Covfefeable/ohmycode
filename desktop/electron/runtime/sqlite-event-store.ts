import { DatabaseSync } from "node:sqlite";
import type { EventStore, ExecutionStore, RuntimeExecutionState } from "@ohmycode/runtime-core";
import type { RuntimeEvent, TurnSnapshot, TurnStatus } from "@ohmycode/protocol";

type TurnRow = {
  turn_id: string;
  thread_id: string;
  status: TurnStatus;
  last_sequence: number;
};

type EventRow = { event_json: string };

export class SqliteEventStore implements EventStore, ExecutionStore {
  private readonly database: DatabaseSync;

  constructor(filePath: string) {
    this.database = new DatabaseSync(filePath);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS runtime_turns (
        turn_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        status TEXT NOT NULL,
        last_sequence INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ix_runtime_turns_thread_updated
        ON runtime_turns(thread_id, updated_at DESC);
      CREATE TABLE IF NOT EXISTS runtime_events (
        turn_id TEXT NOT NULL REFERENCES runtime_turns(turn_id) ON DELETE CASCADE,
        sequence INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (turn_id, sequence)
      );
      CREATE TABLE IF NOT EXISTS runtime_executions (
        turn_id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  load(): TurnSnapshot[] {
    const turns = this.database.prepare(`
      SELECT turn_id, thread_id, status, last_sequence
      FROM runtime_turns
      ORDER BY updated_at ASC
    `).all() as TurnRow[];
    const events = this.database.prepare(`
      SELECT event_json FROM runtime_events WHERE turn_id = ? ORDER BY sequence ASC
    `);
    return turns.map((turn) => ({
      threadId: turn.thread_id,
      turnId: turn.turn_id,
      status: turn.status,
      lastSequence: turn.last_sequence,
      events: (events.all(turn.turn_id) as EventRow[])
        .map((row) => JSON.parse(row.event_json) as RuntimeEvent),
    }));
  }

  create(turn: TurnSnapshot): void {
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO runtime_turns (
        turn_id, thread_id, status, last_sequence, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(turn.turnId, turn.threadId, turn.status, turn.lastSequence, now, now);
  }

  append(event: RuntimeEvent, status: TurnStatus): void {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const now = Date.now();
      this.database.prepare(`
        INSERT INTO runtime_events (turn_id, sequence, event_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(event.turnId, event.sequence, JSON.stringify(event), now);
      this.database.prepare(`
        UPDATE runtime_turns
        SET status = ?, last_sequence = ?, updated_at = ?
        WHERE turn_id = ?
      `).run(status, event.sequence, now, event.turnId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  prune(): void {
    const oldest = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.database.prepare(`
      DELETE FROM runtime_turns
      WHERE status != 'in_progress' AND updated_at < ?
    `).run(oldest);
    this.database.exec(`
      DELETE FROM runtime_turns
      WHERE status != 'in_progress'
        AND turn_id NOT IN (
          SELECT turn_id FROM runtime_turns
          WHERE status != 'in_progress'
          ORDER BY updated_at DESC
          LIMIT 200
        )
    `);
  }

  loadExecutions(): RuntimeExecutionState[] {
    return (this.database.prepare(`
      SELECT state_json FROM runtime_executions ORDER BY updated_at ASC
    `).all() as Array<{ state_json: string }>).map(
      (row) => JSON.parse(row.state_json) as RuntimeExecutionState,
    );
  }

  saveExecution(state: RuntimeExecutionState): void {
    this.database.prepare(`
      INSERT INTO runtime_executions (turn_id, state_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(turn_id) DO UPDATE SET
        state_json = excluded.state_json,
        updated_at = excluded.updated_at
    `).run(state.turnId, JSON.stringify(state), state.updatedAt);
  }

  deleteExecution(turnId: string): void {
    this.database.prepare("DELETE FROM runtime_executions WHERE turn_id = ?").run(turnId);
  }

  close(): void {
    this.database.close();
  }
}
