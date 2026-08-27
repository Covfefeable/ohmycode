import type {
  RuntimeEvent,
  RuntimeEventPayload,
  TurnSnapshot,
  TurnStatus,
} from "@ohmycode/protocol";

type MutableTurn = Omit<TurnSnapshot, "events"> & { events: RuntimeEvent[] };

export interface EventStore {
  load(): TurnSnapshot[];
  create(turn: TurnSnapshot): void;
  append(event: RuntimeEvent, status: TurnStatus): void;
  prune(): void;
  close(): void;
}

export interface EventPublisher {
  publish(event: RuntimeEvent): void;
}

export type RuntimeExecutionState = {
  turnId: string;
  remoteRunId: string;
  phase: "streaming" | "executing_tools" | "resuming" | "recovering" | "interrupting";
  pendingToolCallIds: string[];
  resourceIds: string[];
  updatedAt: number;
};

export interface ExecutionStore {
  loadExecutions(): RuntimeExecutionState[];
  saveExecution(state: RuntimeExecutionState): void;
  deleteExecution(turnId: string): void;
}

export class EventJournal {
  private readonly turns = new Map<string, MutableTurn>();
  private readonly activeByThread = new Map<string, string>();

  constructor(private readonly store?: EventStore) {
    store?.prune();
    for (const snapshot of store?.load() ?? []) {
      const turn = { ...snapshot, events: [...snapshot.events] };
      this.turns.set(turn.turnId, turn);
      this.activeByThread.set(turn.threadId, turn.turnId);
    }
  }

  create(threadId: string, turnId: string): void {
    const turn: MutableTurn = {
      threadId,
      turnId,
      status: "in_progress",
      lastSequence: 0,
      events: [],
    };
    this.store?.create(turn);
    this.turns.set(turnId, turn);
    this.activeByThread.set(threadId, turnId);
  }

  append(turnId: string, event: RuntimeEventPayload): RuntimeEvent {
    const turn = this.turns.get(turnId);
    if (!turn) throw new Error("turn_not_found");
    if (turn.status !== "in_progress") throw new Error("turn_already_finished");
    const stored = { ...event, sequence: turn.lastSequence + 1 } as RuntimeEvent;
    const status = this.statusAfter(turn.status, stored);
    this.store?.append(stored, status);
    turn.lastSequence = stored.sequence;
    turn.events.push(stored);
    turn.status = status;
    return stored;
  }

  snapshotForThread(threadId: string, afterSequence = 0): TurnSnapshot | null {
    const turnId = this.activeByThread.get(threadId);
    return turnId ? this.snapshot(turnId, afterSequence) : null;
  }

  snapshot(turnId: string, afterSequence = 0): TurnSnapshot | null {
    const turn = this.turns.get(turnId);
    if (!turn) return null;
    return {
      ...turn,
      events: turn.events.filter((event) => event.sequence > afterSequence),
    };
  }

  snapshots(status?: TurnStatus): TurnSnapshot[] {
    return [...this.turns.values()]
      .filter((turn) => !status || turn.status === status)
      .map((turn) => ({ ...turn, events: [...turn.events] }));
  }

  close(): void {
    this.store?.close();
  }

  private statusAfter(current: TurnStatus, event: RuntimeEvent): TurnStatus {
    if (event.type === "turn.completed") return "completed";
    if (event.type === "turn.failed") return "failed";
    if (event.type === "turn.interrupted") return "interrupted";
    return current;
  }
}
