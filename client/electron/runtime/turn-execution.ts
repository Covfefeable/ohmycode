import type { LocalMessage } from "../projects/types.js";
import { ApiError, apiRequest } from "../api/api-client.js";
import { executeTerminalAction } from "../terminal/terminal-manager.js";

export class TurnExecution {
  private readonly controller = new AbortController();
  private readonly terminalIds = new Set<string>();
  private remoteRunId: string;

  constructor(turnId: string) {
    this.remoteRunId = turnId;
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  setRemoteRunId(runId: string): void {
    this.remoteRunId = runId;
  }

  registerTerminal(terminalId: string): void {
    this.terminalIds.add(terminalId);
  }

  async interrupt(partialMessage?: LocalMessage): Promise<void> {
    this.controller.abort();
    await Promise.allSettled(
      [...this.terminalIds].map((terminalId) =>
        executeTerminalAction({ action: "stop", terminalId }),
      ),
    );
    if (this.remoteRunId) await this.cancelRemoteRun(partialMessage);
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
}
