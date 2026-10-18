import type { ExecutionStore } from "@ohmycode/agent-runtime";
import { clearInterval, setInterval } from "node:timers";
import { restoreDesktopTurnExecution } from "./desktop-execution-adapter.js";

export function startCancellationRecovery(store: ExecutionStore, isActive: (turnId: string) => boolean): () => void {
  const pending = new Set<string>();
  let closed = false;
  async function reconcile(): Promise<void> {
    if (closed) return;
    for (const state of store.loadExecutions()) {
      if (closed) return;
      if (!state.cancellationPending || isActive(state.turnId) || pending.has(state.turnId)) continue;
      pending.add(state.turnId);
      try {
        await restoreDesktopTurnExecution(state, store).interrupt();
      } catch (error) {
        if (!closed) console.error("[runtime] remote cancellation remains pending", error);
      } finally {
        pending.delete(state.turnId);
      }
    }
  }
  const timer = setInterval(() => { void reconcile(); }, 30_000);
  void reconcile();
  return () => { closed = true; clearInterval(timer); };
}
