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

export type ProviderToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export function toProviderTool(definition: ToolDefinition): ProviderToolDefinition {
  return {
    type: "function",
    function: {
      name: definition.name,
      description: definition.description,
      parameters: definition.inputSchema,
    },
  };
}

export function fromProviderTool(definition: ProviderToolDefinition): ToolDefinition {
  return {
    name: definition.function.name,
    description: definition.function.description,
    inputSchema: definition.function.parameters,
  };
}

export interface ToolExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
}

export interface ToolPlugin extends ToolExecutor {
  readonly id: string;
  definitions(): readonly ToolDefinition[];
  handles(toolName: string): boolean;
  close?(): Promise<void> | void;
}
