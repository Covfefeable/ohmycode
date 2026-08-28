import {
  CapabilityPlugin,
  TASK_PLAN_DEFINITION,
  ToolResultReaderPlugin,
  ToolRegistry,
  type AgentStreamEvent,
  type AgentTask,
  type ToolRequestEvent,
} from "@ohmycode/agent-runtime";
import type {
  ToolCall,
  ToolDefinition,
  ToolExecutor,
  ToolPlugin,
  ProviderToolDefinition,
  ToolResult,
} from "@ohmycode/tool-contracts";
import { fromProviderTool, toProviderTool } from "@ohmycode/tool-contracts";
import { ApiError, apiRequest } from "../api/api-client.js";
import { executeMcpCapability, loadCapability, searchCapabilities } from "../capabilities/capability-manager.js";
import { executeFileTool } from "../files/file-tools.js";
import { executeViewImage, type ViewImageArguments } from "../files/image-tool.js";
import type { FileToolName, FileToolRequest } from "../files/types.js";
import { acquireWorkspaceWriteLock } from "../multi-agents/workspace-write-lock.js";
import { recordWorkspaceChanges, snapshotWorkspace } from "../multi-agents/workspace-changes.js";
import { executeTerminalAction } from "../terminal/terminal-manager.js";
import type { TerminalAction } from "../terminal/types.js";
import type { DesktopExecutionContext } from "./types.js";
import type { DesktopTurnExecution } from "./desktop-execution-adapter.js";
import {
  AGENT_MESSAGE_DEFINITION,
  FILE_DEFINITIONS,
  FINISH_COLLABORATION_DEFINITION,
  TERMINAL_DEFINITION,
  VIEW_IMAGE_DEFINITION,
} from "./desktop-tool-definitions.js";

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

const terminalWriteLeases = new Map<string, () => void>();
type ToolHandler = (request: ToolRequestEvent) => Promise<unknown> | unknown;

function functionalPlugin(
  id: string,
  definitions: readonly ToolDefinition[],
  handler: ToolHandler,
  handles = (toolName: string) => definitions.some((item) => item.name === toolName),
): ToolPlugin {
  return {
    id,
    definitions: () => definitions,
    handles,
    execute: async (call: ToolCall) => ({
      callId: call.callId,
      result: await handler({ type: "tool.requested", ...call }),
    }),
  };
}

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
  private readonly inspectedPaths = new Set<string>();
  private readonly failedToolCalls = new Map<string, number>();
  private readonly leasedTerminalIds = new Set<string>();
  private readonly registry = new ToolRegistry();
  private readonly dynamicDefinitions = new Map<string, ToolDefinition>();

  constructor(private readonly options: RegistryOptions) {
    for (const definition of options.initialDynamicDefinitions ?? []) {
      const parsed = fromProviderTool(definition);
      this.dynamicDefinitions.set(parsed.name, parsed);
    }
    this.registry.register(functionalPlugin(
      "task-plan",
      [TASK_PLAN_DEFINITION],
      (request) => this.updateTasks(request),
    ));
    const collaborationDefinitions = this.options.executionContext
      ? [AGENT_MESSAGE_DEFINITION, ...(this.options.executionContext.isHost ? [FINISH_COLLABORATION_DEFINITION] : [])]
      : [];
    if (collaborationDefinitions.length) this.registry.register(functionalPlugin(
      "collaboration", collaborationDefinitions,
      (request) => this.collaboration(
        request,
        request.tool === "agent_message" ? "messages" : "finish",
      ),
    ));
    if (this.options.supportsVision) this.registry.register(functionalPlugin("image", [VIEW_IMAGE_DEFINITION], (request) => executeViewImage(
      { ...(request.arguments as ViewImageArguments), projectId: this.options.projectId },
      this.options.workspaceRoot,
      this.options.attachmentPaths,
    )));
    this.registry.register(new CapabilityPlugin({
      search: searchCapabilities,
      load: loadCapability,
    }));
    this.registry.register(new ToolResultReaderPlugin({
      read: (runId, callId, options) => apiRequest(
        `/api/agent-runs/${runId}/tool-results/${encodeURIComponent(callId)}/read`,
        { method: "POST", body: JSON.stringify(options) },
      ),
      search: (runId, callId, query, options) => apiRequest(
        `/api/agent-runs/${runId}/tool-results/${encodeURIComponent(callId)}/search`,
        { method: "POST", body: JSON.stringify({ query, ...options }) },
      ),
    }));
    this.registry.register(functionalPlugin(
      "files",
      FILE_DEFINITIONS,
      (request) => this.executeFile(
        request,
        this.options.workspaceRoot,
        this.options.executionContext,
      ),
    ));
    this.registry.register(functionalPlugin("terminal", [TERMINAL_DEFINITION], (request) =>
      this.executeTerminal(
        request.arguments as Record<string, unknown>,
        this.options.workspaceRoot,
        this.options.executionContext,
      )));
    this.registry.register({
      id: "mcp",
      definitions: () => [...this.dynamicDefinitions.values()],
      handles: (toolName) => toolName.startsWith("mcp__"),
      execute: async (call) => ({
        callId: call.callId,
        result: await executeMcpCapability(
          call.tool,
          call.arguments as Record<string, unknown>,
        ),
      }),
    });
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
      result = await this.dispatch(request);
      this.failedToolCalls.delete(signature);
    } catch (error) {
      this.failedToolCalls.set(signature, (this.failedToolCalls.get(signature) ?? 0) + 1);
      result = toolError(error);
    }
    this.options.onEvent({ type: "tool.completed", callId: request.callId, result });
    return { callId: request.callId, result };
  }

  async close(): Promise<void> {
    for (const terminalId of this.leasedTerminalIds) {
      terminalWriteLeases.get(terminalId)?.();
      terminalWriteLeases.delete(terminalId);
    }
    this.leasedTerminalIds.clear();
    await this.registry.close();
  }

  private async dispatch(request: ToolRequestEvent): Promise<unknown> {
    const result = (await this.registry.execute(request)).result;
    if (request.tool === "load_capability" && result && typeof result === "object") {
      const tools = (result as { tools?: unknown }).tools;
      if (Array.isArray(tools)) {
        for (const tool of tools) {
          if (tool && typeof tool === "object" && (tool as ProviderToolDefinition).type === "function") {
            const definition = fromProviderTool(tool as ProviderToolDefinition);
            const existing = this.registry.definitions().find((item) => item.name === definition.name);
            if (existing && !this.dynamicDefinitions.has(definition.name)) {
              throw new Error(`tool_already_registered:${definition.name}`);
            }
            this.dynamicDefinitions.set(definition.name, definition);
          }
        }
      }
      this.options.onDynamicDefinitionsChanged?.(
        [...this.dynamicDefinitions.values()].map(toProviderTool),
      );
    }
    return result;
  }

  private updateTasks(request: ToolRequestEvent): unknown {
    const tasks = (request.arguments as { tasks?: AgentTask[] }).tasks;
    const valid = Array.isArray(tasks)
      && tasks.length <= 20
      && new Set(tasks.map((task) => task.id)).size === tasks.length
      && tasks.filter((task) => task.status === "in_progress").length <= 1
      && tasks.every((task) => task.id?.trim() && task.id.length <= 80
        && task.content?.trim() && task.content.length <= 300
        && ["pending", "in_progress", "completed"].includes(task.status));
    return valid ? { updated: true, taskCount: tasks.length } : { error: "invalid_task_plan" };
  }

  private collaboration(request: ToolRequestEvent, suffix: "messages" | "finish") {
    if (!this.options.executionContext) throw new Error(`${request.tool}_unavailable`);
    return apiRequest(
      `/api/multi-agents/nodes/${this.options.executionContext.ownerId}/${suffix}`,
      { method: "POST", body: JSON.stringify(request.arguments) },
    );
  }

  private async executeFile(
    request: ToolRequestEvent,
    workspaceRoot?: string,
    executionContext?: DesktopExecutionContext,
  ): Promise<unknown> {
    let release: (() => void) | undefined;
    if (executionContext && request.tool === "apply_patch") {
      const unlock = await acquireWorkspaceWriteLock(
        executionContext.workspacePath,
        executionContext.ownerId,
      );
      const before = snapshotWorkspace(executionContext.workspacePath);
      release = () => {
        void recordWorkspaceChanges(
          executionContext.ownerId,
          executionContext.workspacePath,
          before,
        ).finally(unlock);
      };
    }
    try {
      const result = await executeFileTool(
        request.tool as FileToolName,
        { ...(request.arguments as FileToolRequest), projectId: this.options.projectId },
        workspaceRoot,
        this.inspectedPaths,
        this.options.attachmentPaths,
      );
      if (request.tool === "read_file") this.inspectedPaths.add(result.path);
      release?.();
      return result;
    } catch (error) {
      release?.();
      throw error;
    }
  }

  private async executeTerminal(
    action: Record<string, unknown>,
    workspaceRoot?: string,
    executionContext?: DesktopExecutionContext,
  ): Promise<unknown> {
    const actionName = typeof action.action === "string"
      ? action.action
      : action.command ? "start" : action.terminalId && "input" in action ? "write" : action.terminalId ? "read" : "list";
    const normalized = {
      ...action,
      action: actionName,
      projectId: this.options.projectId,
    } as TerminalAction;
    let release: (() => void) | undefined;
    if (executionContext && normalized.action === "start" && normalized.intent !== "read") {
      const unlock = await acquireWorkspaceWriteLock(
        executionContext.workspacePath,
        executionContext.ownerId,
      );
      const before = snapshotWorkspace(executionContext.workspacePath);
      release = () => {
        void recordWorkspaceChanges(
          executionContext.ownerId,
          executionContext.workspacePath,
          before,
        ).finally(unlock);
      };
    }
    let result;
    try {
      result = await executeTerminalAction(
        normalized,
        this.options.execution.signal,
        workspaceRoot,
      );
    } catch (error) {
      release?.();
      throw error;
    }
    const items = Array.isArray(result) ? result : [result];
    if (normalized.action === "start") {
      for (const item of items) if (item.terminalId) this.options.execution.registerResource(item.terminalId);
    }
    if (release) {
      const running = items.find((item) => item.status === "running");
      if (running) {
        terminalWriteLeases.set(running.terminalId, release);
        this.leasedTerminalIds.add(running.terminalId);
      } else release();
    }
    for (const item of items) {
      if (item.status !== "running") {
        terminalWriteLeases.get(item.terminalId)?.();
        terminalWriteLeases.delete(item.terminalId);
        this.leasedTerminalIds.delete(item.terminalId);
      }
    }
    return result;
  }
}
