import {
  ToolRegistry,
  type AgentStreamEvent,
  type ToolRequestEvent,
} from "@ohmycode/agent-runtime";
import type {
  ProviderToolDefinition,
  ToolExecutor,
  ToolResult,
} from "@ohmycode/tool-contracts";
import { toProviderTool } from "@ohmycode/tool-contracts";
import { ApiError } from "../api/api-client.js";
import type { DesktopTurnExecution } from "./desktop-execution-adapter.js";
import type { DesktopExecutionContext } from "./types.js";
import {
  createCapabilityDiscoveryPlugin,
  createDynamicMcpPlugin,
  DynamicToolCatalog,
} from "./tools/capability-plugins.js";
import { createCollaborationPlugin } from "./tools/collaboration-plugin.js";
import { createFilePlugin } from "./tools/file-plugin.js";
import { createImagePlugin } from "./tools/image-plugin.js";
import { createTaskPlanPlugin } from "./tools/task-plan-plugin.js";
import { createTerminalPlugin } from "./tools/terminal-plugin.js";
import { createToolResultPlugin } from "./tools/tool-result-plugin.js";

type RegistryOptions = {
  execution: DesktopTurnExecution;
  executionContext?: DesktopExecutionContext;
  workspaceRoot?: string;
  projectId: string;
  supportsVision: boolean;
  initialDynamicDefinitions?: ProviderToolDefinition[];
  onDynamicDefinitionsChanged?(definitions: ProviderToolDefinition[]): void;
  attachmentPaths: Set<string>;
  onEvent(event: AgentStreamEvent): void;
};

function toolError(error: unknown): { error: string; code?: string } {
  if (error instanceof ApiError && error.code === "agent_cannot_schedule_itself") {
    return {
      code: error.code,
      error: "You cannot hand the collaboration turn to yourself. Choose another member.",
    };
  }
  return { error: error instanceof Error ? error.message : "tool_failed" };
}

function toolSignature(request: ToolRequestEvent): string {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, item]) => [key, sortValue(item)]),
      );
    }
    return value;
  };
  return `${request.tool}:${JSON.stringify(sortValue(request.arguments))}`;
}

export class DesktopToolRegistry implements ToolExecutor {
  private readonly failedToolCalls = new Map<string, number>();
  private readonly registry = new ToolRegistry();

  constructor(private readonly options: RegistryOptions) {
    this.registry.register(createTaskPlanPlugin());
    if (options.executionContext) {
      this.registry.register(createCollaborationPlugin(options.executionContext));
    }
    if (options.supportsVision) {
      this.registry.register(createImagePlugin(options));
    }
    const dynamicTools = new DynamicToolCatalog(
      options.initialDynamicDefinitions ?? [],
      (name) => this.registry.definitions().some((definition) => definition.name === name),
      options.onDynamicDefinitionsChanged,
    );
    this.registry.register(createCapabilityDiscoveryPlugin(dynamicTools));
    this.registry.register(createToolResultPlugin());
    this.registry.register(createFilePlugin(options));
    this.registry.register(createTerminalPlugin(options));
    this.registry.register(createDynamicMcpPlugin(dynamicTools));
  }

  definitions(): ProviderToolDefinition[] {
    return this.registry.definitions().map(toProviderTool);
  }

  async execute(request: ToolRequestEvent): Promise<ToolResult> {
    const signature = toolSignature(request);
    let result: unknown;
    try {
      if ((this.failedToolCalls.get(signature) ?? 0) >= 2) {
        throw new Error(
          "repeated_failed_tool_call: this exact operation has already failed twice; diagnose the cause and choose a different approach",
        );
      }
      result = (await this.registry.execute(request)).result;
      this.failedToolCalls.delete(signature);
    } catch (error) {
      this.failedToolCalls.set(signature, (this.failedToolCalls.get(signature) ?? 0) + 1);
      result = toolError(error);
    }
    this.options.onEvent({ type: "tool.completed", callId: request.callId, result });
    return { callId: request.callId, result };
  }

  close(): Promise<void> {
    return this.registry.close();
  }
}
