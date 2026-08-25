import { BrowserWindow } from "electron";
import type { LocalConversation, LocalMessage, MessageAttachment } from "../projects/types.js";
import {
  stopMessage,
  streamMessage,
  type ConversationStreamEvent,
  type AgentExecutionContext,
} from "../conversations/conversation-service.js";
import { EventJournal } from "./event-journal.js";
import type { RuntimeEvent, RuntimeEventPayload, RuntimeItem, TurnSnapshot } from "./types.js";

type StartTurnInput = {
  threadId: string;
  content: string;
  modelId?: string;
  editMessageId?: string;
  attachments?: MessageAttachment[];
  executionContext?: AgentExecutionContext;
};

const journal = new EventJournal();
const completion = new Map<string, Promise<LocalConversation>>();
const itemState = new Map<string, RuntimeItem>();
const listeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
const interrupting = new Set<string>();
const stateKey = (turnId: string, itemId: string): string => `${turnId}:${itemId}`;

function publish(event: RuntimeEvent): void {
  for (const listener of listeners.get(event.turnId) ?? []) listener(event);
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(`thread:event:${event.threadId}`, event);
  }
}

function append(turnId: string, event: RuntimeEventPayload): RuntimeEvent {
  const stored = journal.append(turnId, event);
  publish(stored);
  return stored;
}

function translate(threadId: string, turnId: string, event: ConversationStreamEvent): void {
  if (event.type === "run.started") return;
  if (event.type === "context.usage") {
    append(turnId, { type: "context.updated", threadId, turnId, usedTokens: event.usedTokens, contextLength: event.contextLength, source: event.source });
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
    const item: RuntimeItem = { id: event.stepId, threadId, turnId, kind: "reasoning", status: "in_progress", content: "" };
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
    const item: RuntimeItem = { id: `message-${turnId}-${crypto.randomUUID()}`, threadId, turnId, kind: "agent_message", status: "in_progress", content: "" };
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
    const item: RuntimeItem = { id: event.callId, threadId, turnId, kind: "tool", status: "in_progress", tool: event.tool, input: event.arguments };
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

export function startTurn(input: StartTurnInput): { turnId: string } {
  const turnId = crypto.randomUUID();
  journal.create(input.threadId, turnId);
  append(turnId, { type: "turn.started", threadId: input.threadId, turnId });
  const running = streamMessage(
    input.threadId,
    input.content,
    input.modelId,
    input.editMessageId,
    input.attachments,
    turnId,
    (event) => translate(input.threadId, turnId, event),
    input.executionContext,
    turnId,
  ).then((conversation) => {
    const snapshot = journal.snapshot(turnId);
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
    const snapshot = journal.snapshot(turnId);
    if (snapshot?.status === "in_progress" && !interrupting.has(turnId)) append(turnId, { type: "turn.failed", threadId: input.threadId, turnId, errorCode: error instanceof Error ? error.message : "runtime_failed" });
    throw error;
  }).finally(() => {
    completion.delete(turnId);
    for (const key of itemState.keys()) if (key.startsWith(`${turnId}:`)) itemState.delete(key);
  });
  completion.set(turnId, running);
  void running.catch(() => undefined);
  return { turnId };
}

export const getThreadSnapshot = (threadId: string, afterSequence = 0): TurnSnapshot | null => journal.snapshotForThread(threadId, afterSequence);
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
  const snapshot = journal.snapshot(turnId);
  if (!snapshot || snapshot.status !== "in_progress") return;
  interrupting.add(turnId);
  try {
    await stopMessage(turnId, partialMessage);
    append(turnId, { type: "turn.interrupted", threadId: snapshot.threadId, turnId });
  } finally {
    interrupting.delete(turnId);
  }
}
