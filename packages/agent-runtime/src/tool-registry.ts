import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolPlugin,
  ToolResult,
} from "@ohmycode/tool-contracts";

export class ToolRegistry implements ToolExecutor {
  private readonly plugins: ToolPlugin[] = [];

  register(plugin: ToolPlugin): void {
    if (!plugin.id || this.plugins.some((item) => item.id === plugin.id)) {
      throw new Error(`tool_plugin_already_registered:${plugin.id}`);
    }
    const existingNames = new Set(this.definitions().map((definition) => definition.name));
    for (const definition of plugin.definitions()) {
      if (existingNames.has(definition.name)) {
        throw new Error(`tool_already_registered:${definition.name}`);
      }
      existingNames.add(definition.name);
    }
    this.plugins.push(plugin);
  }

  definitions(): ToolDefinition[] {
    return this.plugins.flatMap((plugin) => [...plugin.definitions()]);
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const plugin = this.plugins.find((item) => item.handles(call.tool));
    if (!plugin) throw new Error(`unknown_tool:${call.tool}`);
    return plugin.execute(call);
  }

  async close(): Promise<void> {
    await Promise.allSettled(
      [...this.plugins].reverse().map((plugin) => Promise.resolve().then(() => plugin.close?.())),
    );
  }
}

export type CapabilityAdapter = {
  search(query: string): Promise<unknown>;
  load(id: string): Promise<unknown>;
};

const CAPABILITY_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "search_capabilities",
    description: "Search capabilities available on the current client.",
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
  },
  {
    name: "load_capability",
    description: "Load one capability returned by search_capabilities.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

export class CapabilityPlugin implements ToolPlugin {
  readonly id = "capabilities";

  constructor(private readonly adapter: CapabilityAdapter) {}

  definitions(): readonly ToolDefinition[] {
    return CAPABILITY_DEFINITIONS;
  }

  handles(toolName: string): boolean {
    return toolName === "search_capabilities" || toolName === "load_capability";
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments && typeof call.arguments === "object"
      ? call.arguments as { query?: unknown; id?: unknown }
      : {};
    const result = call.tool === "search_capabilities"
      ? await this.adapter.search(String(args.query ?? ""))
      : await this.adapter.load(String(args.id ?? ""));
    return { callId: call.callId, result };
  }
}
