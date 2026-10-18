import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useConversationController } from "./useConversationController";
import { controllerBridge, conversation, deferred, messageText, streamingEvents } from "./controller-test-support";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
const options = { conversationId: "thread", onUpdated: vi.fn(), scrollToBottom: vi.fn() };

test("发送回执晚于流式事件时，保留已输出内容且不重复用户消息", async () => {
  const bridge = controllerBridge();
  const acknowledgement = deferred<{ turnId: string }>();
  bridge.conversations.startTurn.mockReturnValue(acknowledgement.promise);
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  let sending!: Promise<boolean>;
  act(() => { sending = result.current.send("Question"); });
  streamingEvents().forEach(bridge.emit);
  bridge.flush();
  expect(messageText(result.current.conversation?.messages)).toContain("已经收到的内容");
  await act(async () => { acknowledgement.resolve({ turnId: "turn" }); await sending; });
  expect(messageText(result.current.conversation?.messages)).toContain("已经收到的内容");
  expect(result.current.conversation?.messages?.filter((message) => message.role === "user")).toHaveLength(1);
});

test("先收到开始事件，回执仍立即补齐用户消息并保留同一个流式占位", async () => {
  const bridge = controllerBridge();
  const acknowledgement = deferred<{ turnId: string }>();
  bridge.conversations.startTurn.mockReturnValue(acknowledgement.promise);
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  let sending!: Promise<boolean>;
  act(() => { sending = result.current.send("Question"); });
  bridge.emit(streamingEvents()[0]); bridge.flush();
  await act(async () => { acknowledgement.resolve({ turnId: "turn" }); await sending; });
  expect(result.current.conversation?.messages?.map((message) => message.id)).toEqual(["user-turn", "stream-turn"]);
  streamingEvents().slice(1).forEach(bridge.emit); bridge.flush();
  expect(result.current.conversation?.messages?.map((message) => message.id)).toEqual(["saved-user-turn", "stream-turn"]);
});

test("整轮先完成再收到发送回执，不重新开启已经结束的任务", async () => {
  const bridge = controllerBridge();
  const acknowledgement = deferred<{ turnId: string }>();
  bridge.conversations.startTurn.mockReturnValue(acknowledgement.promise);
  bridge.conversations.waitTurn.mockResolvedValue({ ...conversation(), messages: [
    { id: "saved-user-turn", role: "user", content: "Question", createdAt: conversation().createdAt },
    { id: "saved-answer", role: "assistant", content: "Done", createdAt: conversation().createdAt },
  ] });
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  let sending!: Promise<boolean>;
  act(() => { sending = result.current.send("Question"); });
  streamingEvents().forEach(bridge.emit);
  bridge.emit({ type: "turn.completed", threadId: "thread", turnId: "turn", sequence: 5 });
  bridge.flush();
  await waitFor(() => expect(messageText(result.current.conversation?.messages)).toContain("Done"));
  await act(async () => { acknowledgement.resolve({ turnId: "turn" }); await sending; });
  expect(result.current.sending).toBe(false);
  expect(result.current.conversation?.messages?.map((message) => message.id)).toEqual(["saved-user-turn", "saved-answer"]);
});

test("会话卸载不停止后台任务，重新打开通过快照恢复且重放不重复", async () => {
  const bridge = controllerBridge();
  const first = renderHook(() => useConversationController(options));
  await waitFor(() => expect(first.result.current.conversation).not.toBeNull());
  streamingEvents().forEach(bridge.emit); bridge.flush();
  first.unmount();
  expect(bridge.conversations.interruptTurn).not.toHaveBeenCalled();
  const events = streamingEvents();
  bridge.conversations.threadSnapshot.mockResolvedValue({ threadId: "thread", turnId: "turn", status: "in_progress", lastSequence: 4, events });
  const second = renderHook(() => useConversationController(options));
  await waitFor(() => expect(second.result.current.conversation).not.toBeNull());
  events.forEach(bridge.emit); bridge.flush();
  expect(messageText(second.result.current.conversation?.messages)).toBe("Question\n已经收到的内容");
  expect(second.result.current.sending).toBe(true);
});

test("初始化请求未返回时的实时事件与快照重叠，只应用一次", async () => {
  const bridge = controllerBridge();
  const history = deferred<LocalConversation>();
  bridge.conversations.history.mockReturnValue(history.promise);
  const events = streamingEvents();
  bridge.conversations.threadSnapshot.mockResolvedValue({ threadId: "thread", turnId: "turn", status: "in_progress", lastSequence: 4, events });
  const { result } = renderHook(() => useConversationController(options));
  events.forEach(bridge.emit);
  await act(async () => { history.resolve(conversation()); });
  bridge.flush();
  expect(messageText(result.current.conversation?.messages)).toBe("Question\n已经收到的内容");
  expect(result.current.conversation?.messages).toHaveLength(2);
});
