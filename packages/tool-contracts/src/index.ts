import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

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

const MCP_TOOL_PATTERN = /^mcp__([a-f0-9]{24})__([a-zA-Z0-9_-]+)_([a-f0-9]{16})$/;

function stableToken(value: string, length: number): string {
  return bytesToHex(sha256(value)).slice(0, length);
}

export function createMcpToolName(serverId: string, toolName: string): string {
  const label = toolName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 16) || "tool";
  return `mcp__${stableToken(serverId, 24)}__${label}_${stableToken(toolName, 16)}`;
}

export function mcpToolServerToken(toolName: string): string | undefined {
  return MCP_TOOL_PATTERN.exec(toolName)?.[1];
}

export function mcpToolDisplayName(toolName: string): string {
  const match = MCP_TOOL_PATTERN.exec(toolName);
  if (!match) return toolName;
  return match[2].replace(/^_+|_+$/g, "") || "MCP tool";
}

export function matchesMcpServer(serverId: string, token: string): boolean {
  return stableToken(serverId, 24) === token;
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
