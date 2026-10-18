import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useConversationController } from "./useConversationController";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));

test("上一轮完成回显晚到时，不覆盖已经自动开始的新一轮", async () => {
  let listener: (event: RuntimeEvent) => void = () => {};
  let finishPrevious: (value: LocalConversation) => void = () => {};
  const previous = new Promise<LocalConversation>((resolve) => { finishPrevious = resolve; });
  const loaded = { id: "thread", title: "Test", createdAt: "2026-10-18T00:00:00Z", updatedAt: "2026-10-18T00:00:00Z", messages: [] };
  const bridge = {
    conversations: {
      onThreadEvent: (_id: string, callback: typeof listener) => { listener = callback; return () => {}; },
      get: vi.fn(async () => loaded), threadSnapshot: vi.fn(async () => null), waitTurn: vi.fn(() => previous), suggest: vi.fn(async () => []),
    },
    settings: { onModelsChanged: () => () => {}, get: vi.fn(async () => ({ models: [] })) },
  };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: bridge });
  const { result } = renderHook(() => useConversationController({ conversationId: "thread", onUpdated: vi.fn(), scrollToBottom: vi.fn() }));
  await waitFor(() => expect(result.current.conversation?.id).toBe("thread"));
  act(() => listener({ type: "turn.started", threadId: "thread", turnId: "old", sequence: 1 }));
  await waitFor(() => expect(result.current.sending).toBe(true));
  act(() => {
    listener({ type: "turn.completed", threadId: "thread", turnId: "old", sequence: 2 });
    listener({ type: "turn.started", threadId: "thread", turnId: "new", sequence: 1 });
    listener({ type: "item.completed", threadId: "thread", turnId: "new", sequence: 2, item: { id: "new-user", threadId: "thread", turnId: "new", kind: "user_message", status: "completed", content: "Next task", input: { attachments: [], initial: true } } });
  });
  await waitFor(() => expect(result.current.conversation?.messages?.some((item) => item.id === "new-user")).toBe(true));
  act(() => finishPrevious({ ...loaded, messages: [{ id: "old-final", role: "assistant", content: "Previous answer", createdAt: loaded.createdAt }] }));
  await waitFor(() => expect(result.current.conversation?.messages?.some((item) => item.id === "old-final")).toBe(true));
  expect(result.current.sending).toBe(true);
  expect(result.current.conversation?.messages?.filter((item) => item.id === "new-user")).toHaveLength(1);
  expect(result.current.conversation?.messages?.some((item) => item.id === "stream-new")).toBe(true);
  expect(result.current.conversation?.messages?.some((item) => item.id === "stream-old")).toBe(false);
});
