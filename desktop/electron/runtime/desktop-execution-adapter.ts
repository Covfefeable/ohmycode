import { TurnExecution, type TurnExecutionAdapter } from "@ohmycode/agent-runtime";
import type { ExecutionStore, RuntimeExecutionState } from "@ohmycode/runtime-core";
import { ApiError, apiRequest } from "../api/api-client.js";
import type { LocalMessage } from "../projects/types.js";
import { executeTerminalAction } from "../terminal/terminal-manager.js";

const adapter: TurnExecutionAdapter<LocalMessage> = {
  async stopResource(terminalId) {
    await executeTerminalAction({ action: "stop", terminalId });
  },
  async cancelRemoteRun(runId, partialMessage) {
    await apiRequest(`/api/agent-runs/${runId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ partialMessage }),
    });
  },
  isMissingRemoteRunError(error) {
    return error instanceof ApiError && error.status === 404;
  },
  reportCancellationFailure(error) {
    console.error("[runtime] failed to cancel remote run after retries", error);
  },
};

export type DesktopTurnExecution = TurnExecution<LocalMessage>;

export function createDesktopTurnExecution(
  turnId: string,
  store: ExecutionStore,
): DesktopTurnExecution {
  return new TurnExecution(turnId, adapter, store);
}

export function restoreDesktopTurnExecution(
  state: RuntimeExecutionState,
  store: ExecutionStore,
): DesktopTurnExecution {
  return TurnExecution.restore(state, adapter, store);
}
