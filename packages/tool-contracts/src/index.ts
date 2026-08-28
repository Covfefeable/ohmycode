export type ToolCall = {
  runId: string;
  callId: string;
  tool: string;
  arguments: unknown;
  taskId?: string;
};

export type ToolResult = {
  callId: string;
  result: unknown;
};

export type ToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
}

export interface ToolPlugin extends ToolExecutor {
  readonly id: string;
  definitions(): readonly ToolDefinition[];
  handles(toolName: string): boolean;
  close?(): Promise<void> | void;
}
