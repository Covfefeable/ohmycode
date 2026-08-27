import type { ExecutionStore, RuntimeExecutionState } from "@ohmycode/runtime-core";
import type { TurnExecutionAdapter } from "./contracts.js";

export class TurnExecution<PartialState = unknown> {
  private readonly controller = new AbortController();
  private readonly resourceIds = new Set<string>();
  private remoteRunId: string;
  private phase: RuntimeExecutionState["phase"] = "streaming";
  private readonly pendingToolCallIds = new Set<string>();

  constructor(
    private readonly turnId: string,
    private readonly adapter: TurnExecutionAdapter<PartialState>,
    private readonly store?: ExecutionStore,
    persistInitialState = true,
  ) {
    this.remoteRunId = turnId;
    if (persistInitialState) this.persist();
  }

  static restore<PartialState>(
    state: RuntimeExecutionState,
    adapter: TurnExecutionAdapter<PartialState>,
    store: ExecutionStore,
  ): TurnExecution<PartialState> {
    const execution = new TurnExecution(state.turnId, adapter, store, false);
    execution.remoteRunId = state.remoteRunId;
    execution.phase = state.phase;
    for (const callId of state.pendingToolCallIds) execution.pendingToolCallIds.add(callId);
    for (const resourceId of state.resourceIds) execution.resourceIds.add(resourceId);
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

  registerResource(resourceId: string): void {
    this.resourceIds.add(resourceId);
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

  async interrupt(partialState?: PartialState): Promise<void> {
    this.setPhase("interrupting");
    this.controller.abort();
    await Promise.allSettled(
      [...this.resourceIds].map((resourceId) => this.adapter.stopResource(resourceId)),
    );
    if (this.remoteRunId) await this.cancelRemoteRun(partialState);
    this.complete();
  }

  private async cancelRemoteRun(partialState?: PartialState): Promise<void> {
    let lastError: unknown;
    for (const delay of [0, 150, 500, 1_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      try {
        await this.adapter.cancelRemoteRun(this.remoteRunId, partialState);
        return;
      } catch (error) {
        lastError = this.adapter.isMissingRemoteRunError(error) ? undefined : error;
      }
    }
    if (lastError) this.adapter.reportCancellationFailure?.(lastError);
  }

  private persist(): void {
    this.store?.saveExecution({
      turnId: this.turnId,
      remoteRunId: this.remoteRunId,
      phase: this.phase,
      pendingToolCallIds: [...this.pendingToolCallIds],
      resourceIds: [...this.resourceIds],
      updatedAt: Date.now(),
    });
  }
}
