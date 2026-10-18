import type { ExecutionStore, RuntimeExecutionState } from "./event-journal.js";
import type { TurnExecutionAdapter } from "./contracts.js";

export class TurnExecution<PartialState = unknown> {
  private readonly controller = new AbortController();
  private readonly resourceIds = new Set<string>();
  private remoteRunId: string;
  private cancellationPending = false;
  private partialState?: PartialState;

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
    execution.cancellationPending = state.cancellationPending ?? false;
    execution.partialState = state.partialState as PartialState | undefined;
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

  complete(): void {
    if (this.cancellationPending) return;
    this.store?.deleteExecution(this.turnId);
  }

  async interrupt(partialState?: PartialState): Promise<void> {
    this.cancellationPending = true;
    if (partialState !== undefined) this.partialState = partialState;
    this.persist();
    this.controller.abort();
    await Promise.allSettled(
      [...this.resourceIds].map((resourceId) => this.adapter.stopResource(resourceId)),
    );
    if (this.remoteRunId) await this.cancelRemoteRun(this.partialState);
    this.cancellationPending = false;
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
        if (this.adapter.isMissingRemoteRunError(error)) return;
        lastError = error;
      }
    }
    if (lastError) this.adapter.reportCancellationFailure?.(lastError);
    throw new Error("remote_cancellation_pending", { cause: lastError });
  }

  private persist(): void {
    this.store?.saveExecution({
      turnId: this.turnId,
      remoteRunId: this.remoteRunId,
      resourceIds: [...this.resourceIds],
      cancellationPending: this.cancellationPending,
      partialState: this.partialState,
      updatedAt: Date.now(),
    });
  }
}
