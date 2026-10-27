import path from "node:path";
import { app, BrowserWindow } from "electron";
import { EventJournal, TurnEventProjector, type EventPublisher } from "@ohmycode/agent-runtime";
import type { RuntimeEvent, RuntimeEventPayload, TurnSnapshot } from "@ohmycode/protocol";
import type { LocalConversation, LocalMessage, MessageAttachment } from "../projects/types.js";
import {
  streamMessage,
} from "../conversations/conversation-service.js";
import { SqliteEventStore } from "./sqlite-event-store.js";
import type { DesktopExecutionContext } from "./types.js";
import {
  createDesktopTurnExecution,
  type DesktopTurnExecution,
} from "./desktop-execution-adapter.js";
import { initializeFollowups, finishFollowups, followupReceived } from "./followup-host.js";
import { startCancellationRecovery } from "./cancellation-recovery.js";

type StartTurnInput = {
  turnId?: string;
  followupId?: string;
  threadId: string;
  content: string;
  modelId?: string;
  editMessageId?: string;
  attachments?: MessageAttachment[];
  executionContext?: DesktopExecutionContext;
};

let journal: EventJournal | null = null;
let runtimeStore: SqliteEventStore | null = null;
const completion = new Map<string, Promise<LocalConversation>>();
const executions = new Map<string, DesktopTurnExecution>();
let stopCancellationRecovery: (() => void) | undefined;
const activeThreads = new Map<string, string>();
export const activeThreadTurn = (threadId: string): string | undefined => activeThreads.get(threadId);
const listeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
const interrupting = new Set<string>();

const publisher: EventPublisher = {
  publish(event) {
    for (const listener of listeners.get(event.turnId) ?? []) listener(event);
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(`thread:event:${event.threadId}`, event);
    }
  },
};

function append(turnId: string, event: RuntimeEventPayload): RuntimeEvent {
  const stored = requireJournal().append(turnId, event);
  publisher.publish(stored);
  return stored;
}

function requireJournal(): EventJournal {
  if (!journal) throw new Error("runtime_not_initialized");
  return journal;
}

export function initializeAgentRuntime(): void {
  if (journal) return;
  runtimeStore = new SqliteEventStore(
    path.join(app.getPath("userData"), "runtime-events.sqlite"),
  );
  journal = new EventJournal(runtimeStore);
  initializeFollowups(runtimeStore, {
    active: activeThreadTurn,
    start: (threadId, input) => { startTurn({ threadId, turnId: input.turnId, content: input.content, modelId: input.modelId, attachments: input.attachments, followupId: input.id }); },
  });
  const persistedExecutions = new Map(
    runtimeStore.loadExecutions().map((state) => [state.turnId, state]),
  );
  for (const stale of journal.snapshots("in_progress")) {
    append(stale.turnId, {
      type: "turn.interrupted",
      threadId: stale.threadId,
      turnId: stale.turnId,
      reason: "runtime_restarted",
    });
    const executionState = persistedExecutions.get(stale.turnId);
    runtimeStore.saveExecution({
      turnId: stale.turnId,
      remoteRunId: executionState?.remoteRunId ?? stale.turnId,
      resourceIds: executionState?.resourceIds ?? [],
      partialState: executionState?.partialState,
      cancellationPending: true,
      updatedAt: Date.now(),
    });
  }
  stopCancellationRecovery = startCancellationRecovery(runtimeStore, (turnId) => executions.has(turnId) || interrupting.has(turnId));
}

export function closeAgentRuntime(): void {
  stopCancellationRecovery?.();
  journal?.close();
  journal = null;
  runtimeStore = null;
}

export function startTurn(input: StartTurnInput): { turnId: string } {
  if (activeThreads.has(input.threadId)) throw new Error("turn_already_running");
  const turnId = input.turnId ?? crypto.randomUUID();
  requireJournal().create(input.threadId, turnId);
  if (!runtimeStore) throw new Error("runtime_not_initialized");
  const execution = createDesktopTurnExecution(turnId, runtimeStore);
  const projector = new TurnEventProjector(input.threadId, turnId);
  executions.set(turnId, execution);
  activeThreads.set(input.threadId, turnId);
  append(turnId, { type: "turn.started", threadId: input.threadId, turnId });
  const running = streamMessage(
    input.threadId,
    input.content,
    input.modelId,
    input.editMessageId,
    input.attachments,
    (event) => {
      if (event.type === "run.started") {
        if (!input.editMessageId) append(turnId, projector.userMessage(event.messageId ?? `user-${turnId}`, input.content, input.attachments, true));
        if (input.followupId) void followupReceived(input.threadId, input.followupId).catch(console.error);
      }
      if (interrupting.has(turnId)) return;
      if (event.type === "input.received") void followupReceived(input.threadId, event.inputId).catch(console.error);
      for (const projected of projector.project(event)) append(turnId, projected);
    },
    execution,
    input.executionContext,
    turnId,
  ).then((conversation) => {
    const snapshot = requireJournal().snapshot(turnId);
    if (snapshot?.status === "in_progress" && !interrupting.has(turnId)) {
      for (const event of projector.finish()) append(turnId, event);
      append(turnId, { type: "turn.completed", threadId: input.threadId, turnId });
    }
    return conversation;
  }).catch((error) => {
    const snapshot = requireJournal().snapshot(turnId);
    if (snapshot?.status === "in_progress" && !interrupting.has(turnId)) append(turnId, { type: "turn.failed", threadId: input.threadId, turnId, errorCode: error instanceof Error ? error.message : "runtime_failed" });
    throw error;
  }).finally(() => {
    const completed = requireJournal().snapshot(turnId)?.status === "completed";
    completion.delete(turnId);
    executions.delete(turnId);
    execution.complete();
    activeThreads.delete(input.threadId);
    if (!input.executionContext) void finishFollowups(input.threadId, completed).catch(console.error);
  });
  completion.set(turnId, running);
  void running.catch(() => undefined);
  return { turnId };
}

export const getThreadSnapshot = (threadId: string, afterSequence = 0): TurnSnapshot | null => requireJournal().snapshotForThread(threadId, afterSequence);
export const waitForTurn = (turnId: string): Promise<LocalConversation> | null => completion.get(turnId) ?? null;
export function subscribeTurn(turnId: string, listener: (event: RuntimeEvent) => void): () => void {
  const current = listeners.get(turnId) ?? new Set();
  current.add(listener);
  listeners.set(turnId, current);
  return () => {
    current.delete(listener);
    if (!current.size) listeners.delete(turnId);
  };
}

export async function interruptTurn(turnId: string, partialMessage?: LocalMessage): Promise<void> {
  const snapshot = requireJournal().snapshot(turnId);
  if (!snapshot || snapshot.status !== "in_progress" || interrupting.has(turnId)) return;
  interrupting.add(turnId);
  try {
    await executions.get(turnId)?.interrupt(partialMessage);
  } finally {
    append(turnId, { type: "turn.interrupted", threadId: snapshot.threadId, turnId, reason: "user_requested" });
    interrupting.delete(turnId);
  }
}
