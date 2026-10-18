import { expect, it, vi } from "vitest";
import type { RuntimeExecutionState } from "@ohmycode/agent-runtime";

const mocks = vi.hoisted(() => ({
  tick: (() => {}) as () => void,
  clear: vi.fn(),
  restore: vi.fn(),
}));
vi.mock("node:timers", () => ({
  setInterval: (callback: () => void) => { mocks.tick = callback; return 1; },
  clearInterval: mocks.clear,
}));
vi.mock("../../electron/runtime/desktop-execution-adapter.js", () => ({ restoreDesktopTurnExecution: mocks.restore }));
import { startCancellationRecovery } from "../../electron/runtime/cancellation-recovery";

it("retries persisted cancellation, skips active turns and stops polling on close", async () => {
  const states = new Map<string, RuntimeExecutionState>([
    ["pending", { turnId: "pending", remoteRunId: "remote", resourceIds: [], cancellationPending: true, updatedAt: 1 }],
    ["active", { turnId: "active", remoteRunId: "active", resourceIds: [], cancellationPending: true, updatedAt: 1 }],
  ]);
  const store = {
    loadExecutions: () => [...states.values()],
    saveExecution: (state: RuntimeExecutionState) => { states.set(state.turnId, state); },
    deleteExecution: (id: string) => { states.delete(id); },
  };
  const interrupt = vi.fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockImplementationOnce(async () => { store.deleteExecution("pending"); });
  mocks.restore.mockReturnValue({ interrupt });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const close = startCancellationRecovery(store, (id) => id === "active");
  await vi.waitFor(() => expect(interrupt).toHaveBeenCalledTimes(1));
  expect(states.has("pending")).toBe(true);
  mocks.tick();
  await vi.waitFor(() => expect(states.has("pending")).toBe(false));
  expect(states.has("active")).toBe(true);
  expect(mocks.restore).toHaveBeenCalledTimes(2);
  close();
  expect(mocks.clear).toHaveBeenCalled();
  mocks.tick();
  expect(mocks.restore).toHaveBeenCalledTimes(2);
});
