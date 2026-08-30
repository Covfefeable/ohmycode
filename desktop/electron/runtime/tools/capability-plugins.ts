import { CapabilityPlugin } from "@ohmycode/agent-runtime";
import type {
  ProviderToolDefinition,
  ToolCall,
  ToolDefinition,
  ToolPlugin,
  ToolResult,
} from "@ohmycode/tool-contracts";
import { fromProviderTool, toProviderTool } from "@ohmycode/tool-contracts";
import {
  executeMcpCapability,
  loadCapability,
  searchCapabilities,
} from "../../capabilities/capability-manager.js";

export class DynamicToolCatalog {
  private readonly definitions = new Map<string, ToolDefinition>();

  constructor(
    initialDefinitions: ProviderToolDefinition[],
    private readonly hasRegisteredTool: (name: string) => boolean,
    private readonly onDefinitionsChanged?: (definitions: ProviderToolDefinition[]) => void,
  ) {
    for (const definition of initialDefinitions) {
      const parsed = fromProviderTool(definition);
      this.definitions.set(parsed.name, parsed);
    }
  }

  all(): readonly ToolDefinition[] {
    return [...this.definitions.values()];
  }

  has(toolName: string): boolean {
    return this.definitions.has(toolName);
  }

  collect(result: unknown): void {
    const tools = result && typeof result === "object"
      ? (result as { tools?: unknown }).tools
      : undefined;
    if (!Array.isArray(tools)) return;
    for (const tool of tools) {
      if (!tool || typeof tool !== "object" || (tool as ProviderToolDefinition).type !== "function") {
        continue;
      }
      const definition = fromProviderTool(tool as ProviderToolDefinition);
      if (this.hasRegisteredTool(definition.name) && !this.definitions.has(definition.name)) {
        throw new Error(`tool_already_registered:${definition.name}`);
      }
      this.definitions.set(definition.name, definition);
    }
    this.onDefinitionsChanged?.([...this.definitions.values()].map(toProviderTool));
  }
}

export function createCapabilityDiscoveryPlugin(catalog: DynamicToolCatalog): ToolPlugin {
  const discovery = new CapabilityPlugin({ search: searchCapabilities, load: loadCapability });
  return {
    id: discovery.id,
    definitions: () => discovery.definitions(),
    handles: (toolName) => discovery.handles(toolName),
    execute: async (call: ToolCall): Promise<ToolResult> => {
      const output = await discovery.execute(call);
      if (call.tool === "load_capability") catalog.collect(output.result);
      return output;
    },
  };
}

export function createDynamicMcpPlugin(catalog: DynamicToolCatalog): ToolPlugin {
  return {
    id: "mcp",
    definitions: () => catalog.all(),
    handles: (toolName) => catalog.has(toolName),
    execute: async (call) => ({
      callId: call.callId,
      result: await executeMcpCapability(call.tool, call.arguments as Record<string, unknown>),
    }),
  };
}
