import { act } from "@testing-library/react";
import { vi } from "vitest";

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

export const conversation = (id = "thread"): LocalConversation => ({
  id, title: id, createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", messages: [],
});

export function controllerBridge() {
  const listeners = new Map<string, Set<(event: RuntimeEvent) => void>>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.set(++nextFrame, callback);
    return nextFrame;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { frames.delete(id); });
  const bridge = {
    conversations: {
      history: vi.fn<DesktopBridge["conversations"]["history"]>(async (id) => conversation(id)),
      threadSnapshot: vi.fn<DesktopBridge["conversations"]["threadSnapshot"]>(async () => null),
      waitTurn: vi.fn<DesktopBridge["conversations"]["waitTurn"]>(async () => null),
      startTurn: vi.fn<DesktopBridge["conversations"]["startTurn"]>(async () => ({ turnId: "turn" })),
      interruptTurn: vi.fn<DesktopBridge["conversations"]["interruptTurn"]>(async () => {}),
      suggest: vi.fn(async () => [] as string[]),
      onThreadEvent: vi.fn((id: string, listener: (event: RuntimeEvent) => void) => {
        const current = listeners.get(id) ?? new Set();
        current.add(listener);
        listeners.set(id, current);
        return () => { current.delete(listener); };
      }),
    },
    settings: { onModelsChanged: () => () => {}, get: vi.fn(async () => ({ models: [] })) },
  };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: bridge });
  return {
    ...bridge,
    emit(event: RuntimeEvent) { for (const listener of listeners.get(event.threadId) ?? []) listener(event); },
    flush() {
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        for (const callback of callbacks) callback(performance.now());
      });
    },
  };
}

export function streamingEvents(turnId = "turn", threadId = "thread"): RuntimeEvent[] {
  return [
    { type: "turn.started", threadId, turnId, sequence: 1 },
    { type: "item.completed", threadId, turnId, sequence: 2, item: {
      id: `saved-user-${turnId}`, threadId, turnId, kind: "user_message", status: "completed", content: "Question", input: { attachments: [], initial: true },
    } },
    { type: "item.started", threadId, turnId, sequence: 3, item: {
      id: `answer-${turnId}`, threadId, turnId, kind: "agent_message", status: "in_progress", content: "",
    } },
    { type: "item.delta", threadId, turnId, sequence: 4, itemId: `answer-${turnId}`, delta: "已经收到的内容" },
  ];
}

export const messageText = (messages: LocalMessage[] = []) => messages.flatMap((message) =>
  [message.content, ...(message.activity ?? []).flatMap((step) => step.type === "message" ? [step.content] : [])],
).filter(Boolean).join("\n");
