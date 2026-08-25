import type { RuntimeEvent, RuntimeEventPayload, TurnSnapshot, TurnStatus } from "./types.js";

type MutableTurn = Omit<TurnSnapshot, "events"> & { events: RuntimeEvent[] };

export class EventJournal {
  private readonly turns = new Map<string, MutableTurn>();
  private readonly activeByThread = new Map<string, string>();

  create(threadId: string, turnId: string): void {
    this.turns.set(turnId, { threadId, turnId, status: "in_progress", lastSequence: 0, events: [] });
    this.activeByThread.set(threadId, turnId);
  }

  append(turnId: string, event: RuntimeEventPayload): RuntimeEvent {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error("turn_not_found");
    const stored = { ...event, sequence: ++turn.lastSequence } as RuntimeEvent;
    turn.events.push(stored);
    if (stored.type === "turn.completed") this.finish(turn, "completed");
    if (stored.type === "turn.failed") this.finish(turn, "failed");
    if (stored.type === "turn.interrupted") this.finish(turn, "interrupted");
    return stored;
  }

  snapshotForThread(threadId: string, afterSequence = 0): TurnSnapshot | null {
    const turnId = this.activeByThread.get(threadId);
    if (!turnId) return null;
    return this.snapshot(turnId, afterSequence);
  }

  snapshot(turnId: string, afterSequence = 0): TurnSnapshot | null {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    return { ...turn, events: turn.events.filter((event) => event.sequence > afterSequence) };
  }

  private finish(turn: MutableTurn, status: TurnStatus): void {
    turn.status = status;
  }
}
