import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { useMultiAgentExecution } from "./useMultiAgentExecution";
import { deferred } from "../../features/conversation-chat/controller-test-support";

vi.mock("../../features/feedback", () => ({ useFeedback: () => ({ toast }) }));
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

test("协作快照不推测运行终态，执行结束只刷新一次列表", async () => {
  const pending = deferred<MultiAgentTask>();
  let listener!: (event: MultiAgentRunEvent) => void;
  const unsubscribe = vi.fn();
  const task: MultiAgentTask = { id: "task", agentId: "team", title: "Task", request: "Work", status: "running", workspacePath: "/repo", executionLimit: 20, executionCount: 1, members: [], messages: [], createdAt: "2026-10-19T00:00:00Z", updatedAt: "2026-10-19T00:00:00Z" };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: {
    multiAgents: { onEvent: (_id: string, callback: typeof listener) => { listener = callback; return unsubscribe; }, runTask: vi.fn(() => pending.promise) },
  } });
  const reloadAgents = vi.fn(async () => []);
  const { result } = renderHook(() => useMultiAgentExecution({
    models: [{ id: "model", name: "Model", model: "test", baseUrl: "https://example.com", contextLength: 4096, supportsVision: false }],
    selectedAgentId: "team", task, setTask: vi.fn(), setSelectedTaskId: vi.fn(), reloadAgents, reloadModels: vi.fn(async () => []),
  }));
  let execution!: Promise<void>;
  act(() => { execution = result.current.executeTask(task); });
  act(() => listener({ type: "node.event", nodeId: "node", event: { type: "turn.started", threadId: "thread", turnId: "turn", sequence: 1 } }));
  act(() => listener({ type: "task.updated", task: { ...task, status: "failed" } }));
  expect(result.current.liveAgentRuns.node.detail.status).toBe("running");
  act(() => listener({ type: "node.event", nodeId: "node", event: { type: "turn.failed", threadId: "thread", turnId: "turn", sequence: 2, errorCode: "provider_failed" } }));
  expect(result.current.liveAgentRuns.node.detail.status).toBe("failed");
  await act(async () => { pending.resolve({ ...task, status: "failed" }); await execution; });
  expect(reloadAgents).toHaveBeenCalledOnce();
  expect(unsubscribe).toHaveBeenCalledOnce();
});
