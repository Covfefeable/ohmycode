export type ItemKind = "reasoning" | "agent_message" | "tool";
export type ItemStatus = "in_progress" | "completed" | "failed" | "interrupted";
export type TurnStatus = "in_progress" | "completed" | "failed" | "interrupted";

export type RuntimeItem = {
  id: string;
  threadId: string;
  turnId: string;
  kind: ItemKind;
  status: ItemStatus;
  content?: string;
  tool?: string;
  input?: unknown;
  output?: unknown;
  errorCode?: string;
};

export type RuntimeEvent =
  | { sequence: number; type: "turn.started"; threadId: string; turnId: string }
  | { sequence: number; type: "item.started"; threadId: string; turnId: string; item: RuntimeItem }
  | { sequence: number; type: "item.delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { sequence: number; type: "item.completed"; threadId: string; turnId: string; item: RuntimeItem }
  | { sequence: number; type: "turn.completed"; threadId: string; turnId: string }
  | { sequence: number; type: "turn.failed"; threadId: string; turnId: string; errorCode: string }
  | { sequence: number; type: "turn.interrupted"; threadId: string; turnId: string };

export type RuntimeEventPayload = RuntimeEvent extends infer Event
  ? Event extends RuntimeEvent
    ? Omit<Event, "sequence">
    : never
  : never;

export type TurnSnapshot = {
  threadId: string;
  turnId: string;
  status: TurnStatus;
  lastSequence: number;
  events: RuntimeEvent[];
};
