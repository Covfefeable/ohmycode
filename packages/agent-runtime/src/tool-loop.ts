import type { ProviderToolDefinition, ToolExecutor, ToolResult } from "@ohmycode/tool-contracts";
import type { AgentStreamEvent, AgentTransport, TurnController } from "./contracts.js";
import { forwardServerStream } from "./server-stream.js";

export type ToolLoopOptions = {
  response: Response;
  runId: string;
  workspaceInstructions: string;
  transport: AgentTransport;
  tools: ToolExecutor;
  toolSnapshot(): ProviderToolDefinition[];
  execution: TurnController;
  onEvent(event: AgentStreamEvent): void;
};

const RECOVERY_DELAYS = [250, 1_000, 3_000, 8_000, 15_000];

function wait(delay: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, delay);
    signal.addEventListener("abort", aborted, { once: true });
    function done() {
      signal.removeEventListener("abort", aborted);
      resolve();
    }
    function aborted() {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("aborted"));
    }
  });
}

async function recover(
  options: ToolLoopOptions,
  originalError: unknown,
  results: ToolResult[],
): Promise<Response> {
  let lastError = originalError;
  for (const delay of RECOVERY_DELAYS) {
    if (options.execution.signal.aborted) throw lastError;
    await wait(delay, options.execution.signal);
    try {
      return await options.transport.recover(
        options.runId,
        options.workspaceInstructions,
        results,
        options.toolSnapshot(),
      );
    } catch (error) {
      lastError = error;
      const status = typeof error === "object" && error && "status" in error
        ? Number((error as { status: unknown }).status)
        : 0;
      if (status && ![409, 502, 503, 504].includes(status)) throw error;
    }
  }
  throw lastError;
}

export async function runToolLoop(options: ToolLoopOptions): Promise<void> {
  let response = options.response;
  let pendingResults: ToolResult[] = [];
  const seenEvents = new Set<string>();
  while (!options.execution.signal.aborted) {
    let requests;
    let continuationId: string | undefined;
    try {
      requests = await forwardServerStream(response, options.onEvent, seenEvents, (id) => { continuationId = id; });
    } catch (error) {
      response = await recover(options, error, pendingResults);
      pendingResults = [];
      continue;
    }
    if (options.execution.signal.aborted) return;
    if (continuationId) {
      if (!options.transport.continue) throw new Error("continuation_not_supported");
      try {
        response = await options.transport.continue(options.runId, continuationId, options.workspaceInstructions, options.toolSnapshot());
      } catch (error) {
        response = await recover(options, error, []);
      }
      continue;
    }
    if (!requests.length) return;
    const results = await Promise.all(requests.map((request) => options.tools.execute(request)));
    pendingResults = results;
    if (options.execution.signal.aborted) return;
    try {
      response = await options.transport.resume(
        requests[0].runId,
        results,
        options.workspaceInstructions,
        options.toolSnapshot(),
      );
      pendingResults = [];
    } catch (error) {
      response = await recover(options, error, pendingResults);
      pendingResults = [];
    }
  }
}
