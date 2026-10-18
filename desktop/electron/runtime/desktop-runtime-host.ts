import path from "node:path";
import { app, BrowserWindow } from "electron";
import { EventJournal, type EventPublisher } from "@ohmycode/agent-runtime";
import type { RuntimeEvent, RuntimeEventPayload, RuntimeItem, TurnSnapshot } from "@ohmycode/protocol";
import type { LocalConversation, LocalMessage, MessageAttachment } from "../projects/types.js";
import {
  streamMessage,
  type ConversationStreamEvent,
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
const itemState = new Map<string, RuntimeItem>();
const listeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
const interrupting = new Set<string>();
const activeTaskByTurn = new Map<string, string>();
const stateKey = (turnId: string, itemId: string): string => `${turnId}:${itemId}`;

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

function translate(threadId: string, turnId: string, event: ConversationStreamEvent): void {
  if (interrupting.has(turnId)) return;
  if (event.type === "run.started") return;
  if (event.type === "run.continue" || event.type === "input.received") {
    for (const item of itemState.values()) {
      if (item.turnId === turnId && item.status === "in_progress" && item.kind !== "tool") {
        item.status = "completed";
        append(turnId, { type: "item.completed", threadId, turnId, item: { ...item } });
      }
    }
    if (event.type === "input.received") {
      publishUserMessage(threadId, turnId, event.messageId, event.content, event.attachments);
      void followupReceived(threadId, event.inputId).catch(console.error);
    }
    return;
  }
  if (event.type === "context.usage") {
    append(turnId, { type: "context.updated", threadId, turnId, usedTokens: event.usedTokens, contextLength: event.contextLength, source: event.source });
    return;
  }
  if (event.type === "task.plan.updated") {
    const activeTask = event.tasks.find((task) => task.status === "in_progress");
    if (activeTask) activeTaskByTurn.set(turnId, activeTask.id);
    else activeTaskByTurn.delete(turnId);
    append(turnId, { type: "task.updated", threadId, turnId, tasks: event.tasks });
    return;
  }
  if (event.type === "context.compaction.started") {
    const item: RuntimeItem = { id: `context-${turnId}`, threadId, turnId, kind: "context", status: "in_progress" };
    itemState.set(stateKey(turnId, item.id), item);
    append(turnId, { type: "item.started", threadId, turnId, item });
    return;
  }
  if (event.type === "context.compaction.completed") {
    const item = itemState.get(stateKey(turnId, `context-${turnId}`));
    if (item) {
      item.status = "completed";
      append(turnId, { type: "item.completed", threadId, turnId, item: { ...item } });
    }
    return;
  }
  if (event.type === "reasoning.started") {
    const item: RuntimeItem = { id: event.stepId, threadId, turnId, kind: "reasoning", status: "in_progress", content: "", taskId: activeTaskByTurn.get(turnId) };
    itemState.set(stateKey(turnId, item.id), item);
    append(turnId, { type: "item.started", threadId, turnId, item });
    return;
  }
  if (event.type === "reasoning.delta") {
    const item = [...itemState.values()].reverse().find((entry) => entry.turnId === turnId && entry.kind === "reasoning" && entry.status === "in_progress");
    if (item) { item.content = `${item.content ?? ""}${event.content}`; append(turnId, { type: "item.delta", threadId, turnId, itemId: item.id, delta: event.content }); }
    return;
  }
  if (event.type === "message.started") {
    const item: RuntimeItem = { id: `message-${turnId}-${crypto.randomUUID()}`, threadId, turnId, kind: "agent_message", status: "in_progress", content: "", taskId: activeTaskByTurn.get(turnId) };
    itemState.set(stateKey(turnId, item.id), item);
    append(turnId, { type: "item.started", threadId, turnId, item });
    return;
  }
  if (event.type === "message.delta") {
    const item = [...itemState.values()].reverse().find((entry) => entry.turnId === turnId && entry.kind === "agent_message" && entry.status === "in_progress");
    if (item) { item.content = `${item.content ?? ""}${event.content}`; append(turnId, { type: "item.delta", threadId, turnId, itemId: item.id, delta: event.content }); }
    return;
  }
  if (event.type === "tool.requested") {
    for (const item of itemState.values()) {
      if (item.turnId === turnId && item.status === "in_progress" && item.kind !== "tool") {
        item.status = "completed";
        append(turnId, { type: "item.completed", threadId, turnId, item: { ...item } });
      }
    }
    if (event.tool === "update_tasks") return;
    const item: RuntimeItem = { id: event.callId, threadId, turnId, kind: "tool", status: "in_progress", tool: event.tool, input: event.arguments, taskId: event.taskId ?? activeTaskByTurn.get(turnId) };
    itemState.set(stateKey(turnId, item.id), item);
    append(turnId, { type: "item.started", threadId, turnId, item });
    return;
  }
  if (event.type === "tool.completed") {
    const item = itemState.get(stateKey(turnId, event.callId));
    if (item) {
      item.status = "completed";
      item.output = event.result;
      append(turnId, { type: "item.completed", threadId, turnId, item: { ...item } });
    }
    return;
  }
  if (event.type === "run.failed") append(turnId, { type: "turn.failed", threadId, turnId, errorCode: event.errorCode });
}

function publishUserMessage(threadId: string, turnId: string, id: string, content: string, attachments: MessageAttachment[] = [], initial = false): void {
  append(turnId, { type: "item.completed", threadId, turnId, item: { id, threadId, turnId, kind: "user_message", status: "completed", content, input: { attachments, initial } } });
}

export function startTurn(input: StartTurnInput): { turnId: string } {
  if (activeThreads.has(input.threadId)) throw new Error("turn_already_running");
  const turnId = input.turnId ?? crypto.randomUUID();
  requireJournal().create(input.threadId, turnId);
  if (!runtimeStore) throw new Error("runtime_not_initialized");
  const execution = createDesktopTurnExecution(turnId, runtimeStore);
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
        if (!input.editMessageId) publishUserMessage(input.threadId, turnId, event.messageId ?? `user-${turnId}`, input.content, input.attachments, true);
        if (input.followupId) void followupReceived(input.threadId, input.followupId).catch(console.error);
      }
      translate(input.threadId, turnId, event);
    },
    execution,
    input.executionContext,
    turnId,
  ).then((conversation) => {
    const snapshot = requireJournal().snapshot(turnId);
    if (snapshot?.status === "in_progress" && !interrupting.has(turnId)) {
      for (const item of itemState.values()) {
        if (item.turnId === turnId && item.status === "in_progress") {
          item.status = "completed";
          append(turnId, { type: "item.completed", threadId: input.threadId, turnId, item: { ...item } });
        }
      }
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
    for (const key of itemState.keys()) if (key.startsWith(`${turnId}:`)) itemState.delete(key);
    activeTaskByTurn.delete(turnId);
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
