import { act, renderHook, waitFor } from "@testing-library/react";
import type { FollowupState } from "@ohmycode/protocol";
import { expect, test, vi } from "vitest";
import { deferred } from "./controller-test-support";
import { useFollowupQueue } from "./useFollowupQueue";

test("引导收到后移除排队条，晚到的初始化快照不能让它重新出现", async () => {
  const initial = deferred<FollowupState>();
  let listener!: (state: FollowupState) => void;
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { conversations: {
    followups: () => initial.promise,
    onFollowups: (_id: string, callback: typeof listener) => { listener = callback; return vi.fn(); },
  } } });
  const { result } = renderHook(() => useFollowupQueue("thread"));
  const input = { id: "one", content: "Guidance", attachments: [], status: "steering" as const };
  act(() => listener({ inputs: [input], paused: false }));
  expect(result.current.inputs[0].status).toBe("steering");
  act(() => listener({ inputs: [], paused: false }));
  await act(async () => initial.resolve({ inputs: [input], paused: false }));
  expect(result.current.inputs).toEqual([]);
});

test("撤销后的空队列不会被初始化失败或已取消的订阅覆盖", async () => {
  const initial = deferred<FollowupState>();
  let listener!: (state: FollowupState) => void;
  const unsubscribe = vi.fn();
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { conversations: {
    followups: () => initial.promise,
    onFollowups: (_id: string, callback: typeof listener) => { listener = callback; return unsubscribe; },
  } } });
  const { result, unmount } = renderHook(() => useFollowupQueue("thread"));
  act(() => listener({ inputs: [], paused: true }));
  await act(async () => initial.reject(new Error("offline")));
  await waitFor(() => expect(result.current.paused).toBe(true));
  expect(result.current.inputs).toEqual([]);
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
