import {
  CapabilityPlugin,
  ToolRegistry,
  ToolResultReaderPlugin,
  type AgentStreamEvent,
} from "@ohmycode/agent-runtime";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolPlugin,
  ToolResult,
} from "@ohmycode/tool-contracts";

import {
  loadMobileCapability,
  searchMobileCapabilities,
} from "@/shared/capabilities/mobile-capabilities";
import { MobileMcpClient } from "@/shared/capabilities/mobile-mcp";
import { authenticatedRequest } from "@/shared/api/api-client";

function plugin(
  id: string,
  definitions: ToolDefinition[],
  handles: (toolName: string) => boolean,
  execute: (call: ToolCall) => Promise<unknown> | unknown,
  close?: () => Promise<void>,
): ToolPlugin {
  return {
    id,
    definitions: () => definitions,
    handles,
    execute: async (call) => ({ callId: call.callId, result: await execute(call) }),
    close,
  };
}

export class MobileToolRegistry implements ToolExecutor {
  private readonly registry = new ToolRegistry();

  constructor(private readonly onEvent: (event: AgentStreamEvent) => void) {
    const mcp = new MobileMcpClient();
    this.registry.register(plugin(
      "task-plan",
      [{
        name: "update_tasks",
        description: "Update the current task plan.",
        inputSchema: { type: "object", properties: {} },
      }],
      (toolName) => toolName === "update_tasks",
      () => ({ ok: true }),
    ));
    this.registry.register(new CapabilityPlugin({
      search: searchMobileCapabilities,
      load: loadMobileCapability,
    }));
    this.registry.register(new ToolResultReaderPlugin({
      read: (runId, callId, options) => authenticatedRequest(
        `/api/mobile/conversations/runs/${runId}/tool-results/${encodeURIComponent(callId)}/read`,
        { method: "POST", body: JSON.stringify(options) },
      ),
      search: (runId, callId, query, options) => authenticatedRequest(
        `/api/mobile/conversations/runs/${runId}/tool-results/${encodeURIComponent(callId)}/search`,
        { method: "POST", body: JSON.stringify({ query, ...options }) },
      ),
    }));
    this.registry.register(plugin(
      "mcp",
      [],
      (toolName) => toolName.startsWith("mcp__"),
      (call) => mcp.execute(call.tool, call.arguments as Record<string, unknown>),
      () => mcp.close(),
    ));
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    let result: unknown;
    try {
      result = (await this.registry.execute(call)).result;
    } catch (error) {
      result = {
        error: error instanceof Error ? error.message : "tool_failed",
        tool: call.tool,
      };
    }
    this.onEvent({ type: "tool.completed", callId: call.callId, result });
    return { callId: call.callId, result };
  }

  close(): Promise<void> {
    return this.registry.close();
  }
}
