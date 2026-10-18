import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useConversationController } from "./useConversationController";
import { controllerBridge, conversation, deferred, messageText, streamingEvents } from "./controller-test-support";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
const options = { conversationId: "thread", onUpdated: vi.fn(), scrollToBottom: vi.fn() };

test("排队请求失败不把正在运行的任务变为空闲", async () => {
  const bridge = controllerBridge();
  bridge.conversations.startTurn.mockRejectedValue(new Error("queue_failed"));
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  streamingEvents().forEach(bridge.emit); bridge.flush();
  await act(async () => { expect(await result.current.send("Next task")).toBe(false); });
  expect(result.current.sending).toBe(true);
  expect(messageText(result.current.conversation?.messages)).toContain("已经收到的内容");
});

test.each(["turn.completed", "turn.failed", "turn.interrupted"] as const)("收到 %s 即结束运行状态，不等待历史请求", async (type) => {
  const bridge = controllerBridge();
  bridge.conversations.waitTurn.mockReturnValue(deferred<LocalConversation>().promise);
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  streamingEvents().forEach(bridge.emit); bridge.flush();
  bridge.emit(type === "turn.failed"
    ? { type, threadId: "thread", turnId: "turn", sequence: 5, errorCode: "provider_failed" }
    : { type, threadId: "thread", turnId: "turn", sequence: 5 });
  bridge.flush();
  expect(result.current.sending).toBe(false);
  expect(messageText(result.current.conversation?.messages)).toContain("已经收到的内容");
});

test("主动停止保存已输出部分及停止提示，历史读取失败也不清空", async () => {
  const bridge = controllerBridge();
  bridge.conversations.waitTurn.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  bridge.conversations.history.mockRejectedValue(new Error("offline"));
  streamingEvents().forEach(bridge.emit); bridge.flush();
  await act(() => result.current.stop());
  const partial = bridge.conversations.interruptTurn.mock.calls[0][1];
  expect(messageText(partial ? [partial] : [])).toContain("已经收到的内容");
  expect(partial?.content).toContain("stopped");
  bridge.emit({ type: "turn.interrupted", threadId: "thread", turnId: "turn", sequence: 5 }); bridge.flush();
  await act(async () => {});
  expect(messageText(result.current.conversation?.messages)).toContain("已经收到的内容");
  expect(result.current.sending).toBe(false);
});

test("停止 IPC 失败有明确提示，不能假装任务已经停止", async () => {
  const bridge = controllerBridge();
  bridge.conversations.interruptTurn.mockRejectedValue(new Error("ipc_failed"));
  const { result } = renderHook(() => useConversationController(options));
  await waitFor(() => expect(result.current.conversation).not.toBeNull());
  streamingEvents().forEach(bridge.emit); bridge.flush();
  toast.mockClear();
  await act(() => result.current.stop());
  expect(toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" }));
  expect(result.current.sending).toBe(true);
  expect(messageText(result.current.conversation?.messages)).not.toContain("stopped");
});

test("完成回显不能覆盖已经切换到的会话", async () => {
  const bridge = controllerBridge();
  const previous = deferred<LocalConversation>();
  bridge.conversations.waitTurn.mockReturnValue(previous.promise);
  const { result, rerender } = renderHook(({ conversationId }) => useConversationController({ ...options, conversationId }), { initialProps: { conversationId: "thread" } });
  await waitFor(() => expect(result.current.conversation?.id).toBe("thread"));
  streamingEvents().forEach(bridge.emit);
  bridge.emit({ type: "turn.completed", threadId: "thread", turnId: "turn", sequence: 5 }); bridge.flush();
  rerender({ conversationId: "other" });
  await waitFor(() => expect(result.current.conversation?.id).toBe("other"));
  await act(async () => { previous.resolve(conversation()); });
  expect(result.current.conversation?.id).toBe("other");
  expect(result.current.sending).toBe(false);
});

test("发送回执返回前切换会话，不往新会话插入旧任务的消息", async () => {
  const bridge = controllerBridge();
  const acknowledgement = deferred<{ turnId: string }>();
  bridge.conversations.startTurn.mockReturnValue(acknowledgement.promise);
  const { result, rerender } = renderHook(({ conversationId }) => useConversationController({ ...options, conversationId }), { initialProps: { conversationId: "thread" } });
  await waitFor(() => expect(result.current.conversation?.id).toBe("thread"));
  let sending!: Promise<boolean>;
  act(() => { sending = result.current.send("Old question"); });
  rerender({ conversationId: "other" });
  await waitFor(() => expect(result.current.conversation?.id).toBe("other"));
  await act(async () => { acknowledgement.resolve({ turnId: "turn" }); await sending; });
  expect(result.current.conversation?.messages).toEqual([]);
  expect(result.current.sending).toBe(false);
});
