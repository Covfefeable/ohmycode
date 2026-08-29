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

export class DynamicCapabilityPlugins {
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

  capabilityPlugin(): ToolPlugin {
    const base = new CapabilityPlugin({ search: searchCapabilities, load: loadCapability });
    return {
      id: base.id,
      definitions: () => base.definitions(),
      handles: (toolName) => base.handles(toolName),
      execute: async (call: ToolCall): Promise<ToolResult> => {
        const output = await base.execute(call);
        if (call.tool === "load_capability") this.collectDefinitions(output.result);
        return output;
      },
    };
  }

  mcpPlugin(): ToolPlugin {
    return {
      id: "mcp",
      definitions: () => [...this.definitions.values()],
      handles: (toolName) => this.definitions.has(toolName),
      execute: async (call) => ({
        callId: call.callId,
        result: await executeMcpCapability(
          call.tool,
          call.arguments as Record<string, unknown>,
        ),
      }),
    };
  }

  private collectDefinitions(result: unknown): void {
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
