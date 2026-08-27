import type { LocalMessage } from "../projects/types.js";
import type { ExecutionStore, RuntimeExecutionState } from "@ohmycode/runtime-core";
import { ApiError, apiRequest } from "../api/api-client.js";
import { executeTerminalAction } from "../terminal/terminal-manager.js";

export class TurnExecution {
  private readonly controller = new AbortController();
  private readonly terminalIds = new Set<string>();
  private remoteRunId: string;
  private phase: RuntimeExecutionState["phase"] = "streaming";
  private readonly pendingToolCallIds = new Set<string>();

  constructor(
    private readonly turnId: string,
    private readonly store?: ExecutionStore,
    persistInitialState = true,
  ) {
    this.remoteRunId = turnId;
    if (persistInitialState) this.persist();
  }

  static restore(state: RuntimeExecutionState, store: ExecutionStore): TurnExecution {
    const execution = new TurnExecution(state.turnId, store, false);
    execution.remoteRunId = state.remoteRunId;
    execution.phase = state.phase;
    for (const callId of state.pendingToolCallIds) execution.pendingToolCallIds.add(callId);
    for (const terminalId of state.terminalIds) execution.terminalIds.add(terminalId);
    execution.persist();
    return execution;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  setRemoteRunId(runId: string): void {
    this.remoteRunId = runId;
    this.persist();
  }

  registerTerminal(terminalId: string): void {
    this.terminalIds.add(terminalId);
    this.persist();
  }

  setPhase(phase: RuntimeExecutionState["phase"]): void {
    this.phase = phase;
    this.persist();
  }

  setPendingToolCalls(callIds: string[]): void {
    this.pendingToolCallIds.clear();
    for (const callId of callIds) this.pendingToolCallIds.add(callId);
    this.persist();
  }

  complete(): void {
    this.store?.deleteExecution(this.turnId);
  }

  async interrupt(partialMessage?: LocalMessage): Promise<void> {
    this.setPhase("interrupting");
    this.controller.abort();
    await Promise.allSettled(
      [...this.terminalIds].map((terminalId) =>
        executeTerminalAction({ action: "stop", terminalId }),
      ),
    );
    if (this.remoteRunId) await this.cancelRemoteRun(partialMessage);
    this.complete();
  }

  private async cancelRemoteRun(partialMessage?: LocalMessage): Promise<void> {
    let lastError: unknown;
    for (const delay of [0, 150, 500, 1_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await apiRequest(`/api/agent-runs/${this.remoteRunId}/cancel`, {
          method: "POST",
          body: JSON.stringify({ partialMessage }),
        });
        return;
      } catch (error) {
        lastError = error instanceof ApiError && error.status === 404 ? undefined : error;
      }
    }
    if (lastError) {
      console.error("[runtime] failed to cancel remote run after retries", lastError);
    }
  }

  private persist(): void {
    this.store?.saveExecution({
      turnId: this.turnId,
      remoteRunId: this.remoteRunId,
      phase: this.phase,
      pendingToolCallIds: [...this.pendingToolCallIds],
      terminalIds: [...this.terminalIds],
      updatedAt: Date.now(),
    });
  }
}
