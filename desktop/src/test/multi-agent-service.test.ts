import { expect, test, vi } from "vitest";
import { runMultiAgentTask } from "../../electron/multi-agents/multi-agent-service";

const mocks = vi.hoisted(() => ({ api: vi.fn(), start: vi.fn(), subscribe: vi.fn(), wait: vi.fn(), interrupt: vi.fn() }));
vi.mock("electron", () => ({ dialog: {} }));
vi.mock("../../electron/api/api-client", () => ({ apiRequest: mocks.api, apiErrorCode: (_error: unknown, fallback: string) => fallback }));
vi.mock("../../electron/runtime/desktop-runtime-host", () => ({
  startTurn: mocks.start, subscribeTurn: mocks.subscribe, waitForTurn: mocks.wait, interruptTurn: mocks.interrupt,
}));

test("协作工具活动通过事件更新，普通工具完成不额外拉取任务，轮次结束后结算", async () => {
  const member = { id: "member", isHost: true, status: "ready" };
  const task = { id: "task", workspacePath: "/workspace", status: "running", members: [member] };
  const finished = { ...task, status: "waiting_user", members: [{ ...member, status: "idle" }] };
  let started = false;
  mocks.api.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/nodes/member/start")) {
      started = true;
      return { conversationId: "conversation", prompt: "Work" };
    }
    if (url.endsWith("/nodes/member/complete")) return finished;
    if (!init && url.endsWith("/tasks/task")) return started ? { ...task, members: [{ ...member, status: "running" }] } : task;
    throw new Error(`Unexpected request: ${url}`);
  });
  mocks.start.mockReturnValue({ turnId: "turn" });
  const unsubscribe = vi.fn();
  mocks.subscribe.mockImplementation((_turnId, listener) => {
    for (const tool of ["android_screenshot", "read_file"]) listener({
      type: "item.completed", turnId: "turn", threadId: "conversation",
      item: { kind: "tool", tool, output: { executed: true } },
    });
    return unsubscribe;
  });
  mocks.wait.mockResolvedValue({ messages: [{ role: "assistant", content: "Done" }] });
  const onEvent = vi.fn();
  expect(await runMultiAgentTask("task", "request", onEvent)).toEqual(finished);
  expect(mocks.api.mock.calls.filter(([url, init]) => url.endsWith("/tasks/task") && !init)).toHaveLength(2);
  expect(onEvent.mock.calls.filter(([event]) => event.type === "node.event")).toHaveLength(2);
  expect(onEvent).toHaveBeenLastCalledWith({ type: "task.updated", task: finished });
  expect(unsubscribe).toHaveBeenCalledOnce();
});
