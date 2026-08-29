import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolPlugin,
  ToolResult,
} from "@ohmycode/tool-contracts";

export type ToolHandler = (call: ToolCall) => Promise<unknown> | unknown;

export function defineToolPlugin(options: {
  id: string;
  definitions: readonly ToolDefinition[];
  execute: ToolHandler;
  handles?: (toolName: string) => boolean;
  close?: () => Promise<void> | void;
}): ToolPlugin {
  const names = new Set(options.definitions.map((definition) => definition.name));
  return {
    id: options.id,
    definitions: () => options.definitions,
    handles: options.handles ?? ((toolName) => names.has(toolName)),
    execute: async (call: ToolCall): Promise<ToolResult> => ({
      callId: call.callId,
      result: await options.execute(call),
    }),
    close: options.close,
  };
}

export const TASK_PLAN_DEFINITION: ToolDefinition = {
  name: "update_tasks",
  description: "Create or update the task checklist for substantial work. Send the complete current snapshot.",
  inputSchema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          properties: {
            id: { type: "string" }, content: { type: "string" },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["id", "content", "status"],
        },
      },
    },
    required: ["tasks"],
  },
};

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

export type ToolResultReaderAdapter = {
  read(
    runId: string,
    callId: string,
    options: { cursor?: number; maxTokens?: number },
  ): Promise<unknown>;
  search(
    runId: string,
    callId: string,
    query: string,
    options: { maxMatches?: number },
  ): Promise<unknown>;
};

const TOOL_RESULT_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "read_tool_result",
    description: "Read one bounded page from a complete tool result.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        callId: { type: "string" },
        cursor: { type: "integer", minimum: 0 },
        maxTokens: { type: "integer", minimum: 128, maximum: 3000 },
      },
      required: ["callId"],
    },
  },
  {
    name: "search_tool_result",
    description: "Search the complete content behind a truncated tool result.",
    inputSchema: {
      type: "object",
      properties: {
        runId: { type: "string" },
        callId: { type: "string" },
        query: { type: "string" },
        maxMatches: { type: "integer", minimum: 1, maximum: 8 },
      },
      required: ["callId", "query"],
    },
  },
];

export class ToolResultReaderPlugin implements ToolPlugin {
  readonly id = "tool-results";

  constructor(private readonly adapter: ToolResultReaderAdapter) {}

  definitions(): readonly ToolDefinition[] {
    return TOOL_RESULT_DEFINITIONS;
  }

  handles(toolName: string): boolean {
    return toolName === "read_tool_result" || toolName === "search_tool_result";
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const args = call.arguments && typeof call.arguments === "object"
      ? call.arguments as {
        callId?: unknown;
        runId?: unknown;
        cursor?: unknown;
        maxTokens?: unknown;
        query?: unknown;
        maxMatches?: unknown;
      }
      : {};
    const callId = String(args.callId ?? "");
    const resultRunId = String(args.runId ?? call.runId);
    const result = call.tool === "read_tool_result"
      ? await this.adapter.read(resultRunId, callId, {
        cursor: typeof args.cursor === "number" ? args.cursor : undefined,
        maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
      })
      : await this.adapter.search(resultRunId, callId, String(args.query ?? ""), {
        maxMatches: typeof args.maxMatches === "number" ? args.maxMatches : undefined,
      });
    return { callId: call.callId, result };
  }
}
