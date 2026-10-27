import type { RuntimeEventPayload, RuntimeItem, MessageAttachment } from "@ohmycode/protocol";
import type { AgentStreamEvent } from "./contracts.js";

/** Per-turn projection; the host owns persistence, resources and publication. */
export class TurnEventProjector {
  private readonly items = new Map<string, RuntimeItem>();
  private activeTaskId?: string;

  constructor(private readonly threadId: string, private readonly turnId: string) {}

  userMessage(id: string, content: string, attachments: MessageAttachment[] = [], initial = false): RuntimeEventPayload {
    return { type: "item.completed", threadId: this.threadId, turnId: this.turnId,
      item: { id, threadId: this.threadId, turnId: this.turnId, kind: "user_message", status: "completed", content, input: { attachments, initial } } };
  }

  project(event: AgentStreamEvent): RuntimeEventPayload[] {
    const { threadId, turnId } = this;
    const events: RuntimeEventPayload[] = [];
    const emit = (value: RuntimeEventPayload) => events.push("item" in value ? { ...value, item: { ...value.item } } : value);
    if (event.type === "run.started") return events;
    if (event.type === "run.continue" || event.type === "input.received") {
      for (const item of this.items.values()) {
        if (item.turnId === turnId && item.status === "in_progress" && item.kind !== "tool") {
          item.status = "completed";
          emit({ type: "item.completed", threadId, turnId, item: { ...item } });
        }
      }
      if (event.type === "input.received") {
        emit(this.userMessage(event.messageId, event.content, event.attachments));
      }
      return events;
    }
    if (event.type === "context.usage") {
      emit({ type: "context.updated", threadId, turnId, usedTokens: event.usedTokens, contextLength: event.contextLength, source: event.source });
      return events;
    }
    if (event.type === "task.plan.updated") {
      const activeTask = event.tasks.find((task) => task.status === "in_progress");
      if (activeTask) this.activeTaskId = activeTask.id;
      else this.activeTaskId = undefined;
      emit({ type: "task.updated", threadId, turnId, tasks: event.tasks });
      return events;
    }
    if (event.type === "context.compaction.started") {
      const item: RuntimeItem = { id: `context-${turnId}`, threadId, turnId, kind: "context", status: "in_progress" };
      this.items.set(item.id, item);
      emit({ type: "item.started", threadId, turnId, item });
      return events;
    }
    if (event.type === "context.compaction.completed") {
      const item = this.items.get(`context-${turnId}`);
      if (item) {
        item.status = "completed";
        emit({ type: "item.completed", threadId, turnId, item: { ...item } });
      }
      return events;
    }
    if (event.type === "reasoning.started") {
      const item: RuntimeItem = { id: event.stepId, threadId, turnId, kind: "reasoning", status: "in_progress", content: "", taskId: this.activeTaskId };
      this.items.set(item.id, item);
      emit({ type: "item.started", threadId, turnId, item });
      return events;
    }
    if (event.type === "reasoning.delta") {
      const item = [...this.items.values()].reverse().find((entry) => entry.turnId === turnId && entry.kind === "reasoning" && entry.status === "in_progress");
      if (item) { item.content = `${item.content ?? ""}${event.content}`; emit({ type: "item.delta", threadId, turnId, itemId: item.id, delta: event.content }); }
      return events;
    }
    if (event.type === "message.started") {
      const item: RuntimeItem = { id: `message-${turnId}-${crypto.randomUUID()}`, threadId, turnId, kind: "agent_message", status: "in_progress", content: "", taskId: this.activeTaskId };
      this.items.set(item.id, item);
      emit({ type: "item.started", threadId, turnId, item });
      return events;
    }
    if (event.type === "message.delta") {
      const item = [...this.items.values()].reverse().find((entry) => entry.turnId === turnId && entry.kind === "agent_message" && entry.status === "in_progress");
      if (item) { item.content = `${item.content ?? ""}${event.content}`; emit({ type: "item.delta", threadId, turnId, itemId: item.id, delta: event.content }); }
      return events;
    }
    if (event.type === "tool.requested") {
      for (const item of this.items.values()) {
        if (item.turnId === turnId && item.status === "in_progress" && item.kind !== "tool") {
          item.status = "completed";
          emit({ type: "item.completed", threadId, turnId, item: { ...item } });
        }
      }
      if (event.tool === "update_tasks") return events;
      const item: RuntimeItem = { id: event.callId, threadId, turnId, kind: "tool", status: "in_progress", tool: event.tool, input: event.arguments, taskId: event.taskId ?? this.activeTaskId };
      this.items.set(item.id, item);
      emit({ type: "item.started", threadId, turnId, item });
      return events;
    }
    if (event.type === "tool.completed") {
      const item = this.items.get(event.callId);
      if (item) {
        item.status = "completed";
        item.output = event.result;
        emit({ type: "item.completed", threadId, turnId, item: { ...item } });
      }
      return events;
    }
    if (event.type === "run.failed") emit({ type: "turn.failed", threadId, turnId, errorCode: event.errorCode });
    return events;
  }

  finish(): RuntimeEventPayload[] {
    const events: RuntimeEventPayload[] = [];
    for (const item of this.items.values()) {
      if (item.status !== "in_progress") continue;
      item.status = "completed";
      events.push({ type: "item.completed", threadId: this.threadId, turnId: this.turnId, item: { ...item } });
    }
    return events;
  }
}
