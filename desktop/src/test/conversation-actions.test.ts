import { beforeEach, expect, it, vi } from "vitest";
import { removeConversation, submitConversationMessage } from "../../electron/conversations/conversation-actions";

const mocks = vi.hoisted(() => ({ activeThreadTurn: vi.fn(), startTurn: vi.fn(), followupSnapshot: vi.fn(), enqueueFollowup: vi.fn(), deleteConversation: vi.fn(), closeSession: vi.fn() }));
vi.mock("../../electron/browser/browser-service", () => ({ activeBrowser: () => ({ closeSession: mocks.closeSession }) }));
vi.mock("../../electron/projects/projects-service", () => ({ deleteConversation: mocks.deleteConversation }));
vi.mock("../../electron/runtime/desktop-runtime-host", () => ({ activeThreadTurn: mocks.activeThreadTurn, startTurn: mocks.startTurn }));
vi.mock("../../electron/runtime/followup-host", () => ({ followupSnapshot: mocks.followupSnapshot, enqueueFollowup: mocks.enqueueFollowup }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.activeThreadTurn.mockReturnValue(undefined);
  mocks.startTurn.mockReturnValue({ turnId: "turn" });
  mocks.followupSnapshot.mockResolvedValue({ inputs: [] });
  mocks.enqueueFollowup.mockResolvedValue(undefined);
  mocks.deleteConversation.mockResolvedValue(undefined);
});

it("空闲会话直接启动，同样传递模型、编辑位置和附件", async () => {
  expect(await submitConversationMessage({ conversationId: "thread", content: "hello", modelId: "model" })).toEqual({ turnId: "turn" });
  expect(mocks.startTurn).toHaveBeenCalledWith({ threadId: "thread", content: "hello", modelId: "model", editMessageId: undefined, attachments: [] });
  expect(mocks.enqueueFollowup).not.toHaveBeenCalled();
});

it.each(["active", "pending"])("已有 %s 消息时保留排队行为，不启动第二个 Turn", async (kind) => {
  if (kind === "active") mocks.activeThreadTurn.mockReturnValue("running");
  else mocks.followupSnapshot.mockResolvedValue({ inputs: [{ id: "existing" }] });
  expect(await submitConversationMessage({ conversationId: "thread", content: "next", modelId: "model" })).toEqual({ queued: true });
  expect(mocks.enqueueFollowup).toHaveBeenCalledWith("thread", { id: expect.any(String), content: "next", modelId: "model", attachments: [], status: "queued" });
  expect(mocks.startTurn).not.toHaveBeenCalled();
});

it("编辑重发不转成普通排队消息", async () => {
  mocks.activeThreadTurn.mockReturnValue("running");
  await submitConversationMessage({ conversationId: "thread", content: "edit", editMessageId: "message" });
  expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({ editMessageId: "message" }));
  expect(mocks.enqueueFollowup).not.toHaveBeenCalled();
});

it("排队失败直接报错，不继续启动任务", async () => {
  mocks.activeThreadTurn.mockReturnValue("running");
  mocks.enqueueFollowup.mockRejectedValueOnce(new Error("offline"));
  await expect(submitConversationMessage({ conversationId: "thread", content: "hello" })).rejects.toThrow("offline");
  expect(mocks.startTurn).not.toHaveBeenCalled();
});

it("仅在服务端删除成功后关闭对应浏览器会话", async () => {
  await removeConversation("project", "thread");
  expect(mocks.deleteConversation).toHaveBeenCalledWith("project", "thread");
  expect(mocks.closeSession).toHaveBeenCalledWith("thread");
  mocks.closeSession.mockClear();
  mocks.deleteConversation.mockRejectedValueOnce(new Error("offline"));
  await expect(removeConversation("project", "thread")).rejects.toThrow("offline");
  expect(mocks.closeSession).not.toHaveBeenCalled();
});
