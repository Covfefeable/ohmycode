import {
  CapabilityPlugin,
  defineToolPlugin,
  TASK_PLAN_DEFINITION,
  ToolRegistry,
  ToolResultReaderPlugin,
  type AgentStreamEvent,
} from "@ohmycode/agent-runtime";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ProviderToolDefinition,
  ToolResult,
} from "@ohmycode/tool-contracts";
import { fromProviderTool, toProviderTool } from "@ohmycode/tool-contracts";

import {
  loadMobileCapability,
  searchMobileCapabilities,
} from "@/shared/capabilities/mobile-capabilities";
import { MobileMcpClient } from "@/shared/capabilities/mobile-mcp";
import { authenticatedRequest } from "@/shared/api/api-client";

export class MobileToolRegistry implements ToolExecutor {
  private readonly registry = new ToolRegistry();
  private readonly dynamicDefinitions = new Map<string, ToolDefinition>();

  constructor(
    private readonly onEvent: (event: AgentStreamEvent) => void,
    private readonly signal?: AbortSignal,
    initialDynamicDefinitions: ProviderToolDefinition[] = [],
    private readonly onDynamicDefinitionsChanged?: (definitions: ProviderToolDefinition[]) => void,
  ) {
    for (const definition of initialDynamicDefinitions) {
      const parsed = fromProviderTool(definition);
      this.dynamicDefinitions.set(parsed.name, parsed);
    }
    const mcp = new MobileMcpClient();
    this.registry.register(defineToolPlugin({
      id: "task-plan",
      definitions: [TASK_PLAN_DEFINITION],
      execute: () => ({ ok: true }),
    }));
    this.registry.register(new CapabilityPlugin({
      search: (query) => searchMobileCapabilities(query, signal),
      load: async (id) => {
        const result = await loadMobileCapability(id, signal);
        if (result && typeof result === "object" && Array.isArray((result as { tools?: unknown }).tools)) {
          for (const tool of (result as { tools: unknown[] }).tools) {
            if (tool && typeof tool === "object" && (tool as ProviderToolDefinition).type === "function") {
              const definition = fromProviderTool(tool as ProviderToolDefinition);
              const existing = this.registry.definitions().find((item) => item.name === definition.name);
              if (existing && !this.dynamicDefinitions.has(definition.name)) {
                throw new Error(`tool_already_registered:${definition.name}`);
              }
              this.dynamicDefinitions.set(definition.name, definition);
            }
          }
          this.onDynamicDefinitionsChanged?.(
            [...this.dynamicDefinitions.values()].map(toProviderTool),
          );
        }
        return result;
      },
    }));
    this.registry.register(new ToolResultReaderPlugin({
      read: (runId, callId, options) => authenticatedRequest(
        `/api/mobile/conversations/runs/${runId}/tool-results/${encodeURIComponent(callId)}/read`,
        { method: "POST", body: JSON.stringify(options), signal },
      ),
      search: (runId, callId, query, options) => authenticatedRequest(
        `/api/mobile/conversations/runs/${runId}/tool-results/${encodeURIComponent(callId)}/search`,
        { method: "POST", body: JSON.stringify({ query, ...options }), signal },
      ),
    }));
    this.registry.register({
      id: "mcp",
      definitions: () => [...this.dynamicDefinitions.values()],
      handles: (toolName) => toolName.startsWith("mcp__"),
      execute: async (call) => ({
        callId: call.callId,
        result: await mcp.execute(call.tool, call.arguments as Record<string, unknown>, signal),
      }),
      close: () => mcp.close(),
    });
  }

  definitions(): ProviderToolDefinition[] {
    return this.registry.definitions().map(toProviderTool);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    let result: unknown;
    try {
      result = (await this.registry.execute(call)).result;
    } catch (error) {
      if (this.signal?.aborted) throw error;
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
