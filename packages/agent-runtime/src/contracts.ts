import type { ExecutionStore, RuntimeExecutionState } from "@ohmycode/runtime-core";
import type { ToolExecutor, ToolResult } from "@ohmycode/tool-contracts";

export type AgentTask = {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed";
};

export type ToolRequestEvent = {
  type: "tool.requested";
  runId: string;
  callId: string;
  tool: string;
  arguments: unknown;
  taskId?: string;
};

export type AgentStreamEvent =
  | { type: "reasoning.delta" | "message.delta"; content: string }
  | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "message.started" }
  | { type: "context.usage"; usedTokens: number; contextLength: number; source: "estimated" | "provider" }
  | { type: "context.compaction.started" | "context.compaction.completed"; estimatedTokens: number; contextLength: number }
  | { type: "task.plan.updated"; tasks: AgentTask[] }
  | ToolRequestEvent
  | { type: "tool.completed"; callId: string; result: unknown };

export interface AgentTransport {
  resume(runId: string, results: ToolResult[], workspaceInstructions: string): Promise<Response>;
  recover(
    runId: string,
    workspaceInstructions: string,
    partialContent: string,
    partialReasoning: string,
    results: ToolResult[],
  ): Promise<Response>;
}

export interface TurnController {
  readonly signal: AbortSignal;
  setPhase(phase: RuntimeExecutionState["phase"]): void;
  setPendingToolCalls(callIds: string[]): void;
}

export interface RuntimeLifecycle {
  onSuspend(listener: () => void): () => void;
  onResume(listener: () => void): () => void;
}

export interface TurnExecutionAdapter<PartialState = unknown> {
  stopResource(resourceId: string): Promise<void>;
  cancelRemoteRun(runId: string, partialState?: PartialState): Promise<void>;
  isMissingRemoteRunError(error: unknown): boolean;
  reportCancellationFailure?(error: unknown): void;
}

export type RuntimePorts<PartialState = unknown> = {
  executionStore?: ExecutionStore;
  executionAdapter: TurnExecutionAdapter<PartialState>;
  tools: ToolExecutor;
};
