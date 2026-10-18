import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { MessageLocation } from "../../../entities/conversation/types";
import { conversation, deferred } from "../controller-test-support";
import { useConversationSearch } from "./useConversationSearch";

const message = (id: string): LocalMessage => ({ id, content: id, role: "assistant", createdAt: conversation().createdAt });
function bridge() {
  const searchMessages = vi.fn<DesktopBridge["conversations"]["searchMessages"]>(async () => ({ messageId: "old", position: 1, total: 2 }));
  const history = vi.fn<DesktopBridge["conversations"]["history"]>(async () => ({ ...conversation(), messages: [message("old")], olderCursor: "before", newerCursor: "after" }));
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { conversations: { searchMessages, history } } });
  return { searchMessages, history };
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(250); });
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

test("搜索服务端历史，按消息 ID 加载附近页而不是整段会话", async () => {
  const api = bridge();
  const { result } = renderHook(() => useConversationSearch("thread"));
  act(() => { result.current.open(); result.current.changeQuery("old"); });
  expect(result.current.loading).toBe(true);
  await flush();
  expect(api.searchMessages).toHaveBeenCalledExactlyOnceWith("thread", { query: "old" });
  expect(api.history).toHaveBeenCalledExactlyOnceWith("thread", { around: "old" });
  expect(result.current.view?.location.messageId).toBe("old");
  expect(result.current.result?.total).toBe(2);
  expect(result.current.loading).toBe(false);
});

test("快速更换关键词，晚到的旧搜索不会覆盖新定位", async () => {
  const api = bridge();
  const old = deferred<MessageSearchResult>();
  api.searchMessages.mockReturnValueOnce(old.promise).mockResolvedValueOnce({ messageId: "new", position: 1, total: 1 });
  const { result } = renderHook(() => useConversationSearch("thread"));
  act(() => result.current.changeQuery("old")); await flush();
  act(() => result.current.changeQuery("new")); await flush();
  await act(async () => old.resolve({ messageId: "old", position: 1, total: 5 }));
  expect(result.current.view?.location.messageId).toBe("new");
  expect(api.history).toHaveBeenCalledTimes(1);
});

test("返回最新消息后，晚到的历史窗口不能再次抢回界面", async () => {
  const api = bridge();
  const pending = deferred<LocalConversation>();
  api.history.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useConversationSearch("thread"));
  act(() => result.current.changeQuery("old")); await flush();
  act(() => result.current.returnLatest());
  await act(async () => pending.resolve({ ...conversation(), messages: [message("old")] }));
  expect(result.current.view).toBeNull();
  expect(result.current.loading).toBe(false);
});

test("历史窗口双向分页去重，不改后台会话或丢失另一侧游标", async () => {
  const api = bridge();
  const { result } = renderHook(() => useConversationSearch("thread"));
  act(() => result.current.changeQuery("old")); await flush();
  api.history.mockResolvedValueOnce({ ...conversation(), messages: [message("earlier"), message("old")], olderCursor: null });
  await act(() => result.current.loadOlder());
  expect(result.current.view?.page.messages?.map((item) => item.id)).toEqual(["earlier", "old"]);
  expect(result.current.view?.prepended).toBe(1);
  expect(result.current.view?.page.newerCursor).toBe("after");
  api.history.mockResolvedValueOnce({ ...conversation(), messages: [message("later")], newerCursor: null });
  await act(() => result.current.loadNewer());
  expect(api.history).toHaveBeenLastCalledWith("thread", { after: "after" });
  expect(result.current.view?.page.messages?.map((item) => item.id)).toEqual(["earlier", "old", "later"]);
  expect(result.current.view?.page.olderCursor).toBeNull();
});

test("重复点击全局同一搜索结果仍会重新定位，关闭搜索不丢阅读窗口", async () => {
  const api = bridge();
  const target: MessageLocation = { messageId: "old", query: "old" };
  const { result, rerender } = renderHook(({ location }) => useConversationSearch("thread", location), { initialProps: { location: target } });
  await flush();
  const revision = result.current.view?.revision;
  rerender({ location: { ...target } }); await flush();
  expect(api.searchMessages).toHaveBeenCalledTimes(2);
  expect(result.current.view?.revision).not.toBe(revision);
  act(() => result.current.close()); await flush();
  expect(result.current.opened).toBe(false);
  expect(result.current.view?.location.messageId).toBe("old");
  expect(result.current.result).toBeNull();
});

test("空搜索和无匹配不请求历史；失败可以重试", async () => {
  const api = bridge();
  const { result } = renderHook(() => useConversationSearch("thread"));
  act(() => result.current.changeQuery(" ")); await flush();
  expect(api.searchMessages).not.toHaveBeenCalled();
  api.searchMessages.mockRejectedValueOnce(new Error("offline"));
  act(() => result.current.changeQuery("old")); await flush();
  expect(result.current.failed).toBe(true);
  act(() => result.current.retry()); await flush();
  expect(result.current.failed).toBe(false);
  expect(result.current.view).not.toBeNull();
  api.searchMessages.mockResolvedValueOnce({ messageId: null, position: 0, total: 0 });
  act(() => result.current.changeQuery("missing")); await flush();
  expect(result.current.result?.total).toBe(0);
  expect(api.history).toHaveBeenCalledTimes(1);
});
