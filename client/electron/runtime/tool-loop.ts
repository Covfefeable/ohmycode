import type { ConversationTransport } from "../conversations/conversation-transport.js";
import { forwardServerStream, type ConversationStreamEvent } from "../conversations/server-stream.js";
import type { RuntimeToolRegistry, ToolResult } from "./tool-registry.js";
import type { TurnExecution } from "./turn-execution.js";

type ToolLoopOptions = {
  response: Response;
  runId: string;
  workspaceInstructions: string;
  transport: ConversationTransport;
  registry: RuntimeToolRegistry;
  execution: TurnExecution;
  onEvent(event: ConversationStreamEvent): void;
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
  partialContent: string,
  partialReasoning: string,
  results: ToolResult[],
): Promise<Response> {
  let lastError = originalError;
  for (const delay of RECOVERY_DELAYS) {
    if (options.execution.signal.aborted) throw lastError;
    await wait(delay, options.execution.signal);
    try {
      options.execution.setPhase("recovering");
      return await options.transport.recover(
        options.runId,
        options.workspaceInstructions,
        partialContent,
        partialReasoning,
        results,
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
  let partialContent = "";
  let partialReasoning = "";
  let pendingResults: ToolResult[] = [];
  const consume = (event: ConversationStreamEvent) => {
    if (event.type === "message.delta") partialContent += event.content;
    if (event.type === "reasoning.delta") partialReasoning += event.content;
    options.onEvent(event);
  };
  while (!options.execution.signal.aborted) {
    options.execution.setPhase("streaming");
    let requests;
    try {
      requests = await forwardServerStream(response, consume);
    } catch (error) {
      response = await recover(
        options,
        error,
        partialContent,
        partialReasoning,
        pendingResults,
      );
      if (pendingResults.length) options.execution.setPendingToolCalls([]);
      pendingResults = [];
      continue;
    }
    if (!requests.length || options.execution.signal.aborted) return;
    options.execution.setPhase("executing_tools");
    options.execution.setPendingToolCalls(requests.map((request) => request.callId));
    const results = await Promise.all(requests.map((request) => options.registry.execute(request)));
    pendingResults = results;
    partialContent = "";
    partialReasoning = "";
    if (options.execution.signal.aborted) return;
    try {
      options.execution.setPhase("resuming");
      response = await options.transport.resume(
        requests[0].runId,
        results,
        options.workspaceInstructions,
      );
      pendingResults = [];
      options.execution.setPendingToolCalls([]);
    } catch (error) {
      response = await recover(
        options,
        error,
        partialContent,
        partialReasoning,
        pendingResults,
      );
      options.execution.setPendingToolCalls([]);
      pendingResults = [];
    }
  }
}
