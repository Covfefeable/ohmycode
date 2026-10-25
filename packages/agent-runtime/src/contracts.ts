import type { AgentTask } from "@ohmycode/protocol";
import type { ProviderToolDefinition, ToolResult } from "@ohmycode/tool-contracts";

export type { AgentTask } from "@ohmycode/protocol";

export type ToolRequestEvent = {
  type: "tool.requested";
  runId: string;
  callId: string;
  tool: string;
  arguments: unknown;
  taskId?: string;
  rejection?: { error: string; message: string };
};

export type AgentStreamEvent =
  | { type: "run.continue"; runId: string; executionId: string }
  | { type: "input.received"; inputId: string; messageId: string; content: string; attachments: import("@ohmycode/protocol").FollowupInput["attachments"]; createdAt: string }
  | { type: "reasoning.delta" | "message.delta"; content: string }
  | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string; messageId?: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "message.started" }
  | { type: "context.usage"; usedTokens: number; contextLength: number; source: "estimated" | "provider" }
  | { type: "context.compaction.started" | "context.compaction.completed"; estimatedTokens: number; contextLength: number }
  | { type: "task.plan.updated"; tasks: AgentTask[] }
  | ToolRequestEvent
  | { type: "tool.completed"; callId: string; result: unknown };

export interface AgentTransport {
  continue?(runId: string, executionId: string, workspaceInstructions: string, tools: ProviderToolDefinition[]): Promise<Response>;
  resume(runId: string, results: ToolResult[], workspaceInstructions: string, tools: ProviderToolDefinition[]): Promise<Response>;
  recover(
    runId: string,
    workspaceInstructions: string,
    results: ToolResult[],
    tools: ProviderToolDefinition[],
  ): Promise<Response>;
}

export interface TurnController {
  readonly signal: AbortSignal;
}

export interface TurnExecutionAdapter<PartialState = unknown> {
  stopResource(resourceId: string): Promise<void>;
  cancelRemoteRun(runId: string, partialState?: PartialState): Promise<void>;
  isMissingRemoteRunError(error: unknown): boolean;
  reportCancellationFailure?(error: unknown): void;
}
