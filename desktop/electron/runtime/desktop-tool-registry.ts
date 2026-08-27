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

type RegistryOptions = {
  execution: DesktopTurnExecution;
  executionContext?: DesktopExecutionContext;
  workspaceRoot?: string;
  attachmentPaths: Set<string>;
  onEvent(event: AgentStreamEvent): void;
};

const FILE_TOOLS = new Set(["read_file", "search_files", "list_directory", "apply_patch"]);
const terminalWriteLeases = new Map<string, () => void>();
type ToolHandler = (request: ToolRequestEvent) => Promise<unknown> | unknown;

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
  private readonly handlers = new Map<string, ToolHandler>();

  constructor(private readonly options: RegistryOptions) {
    this.register("update_tasks", (request) => this.updateTasks(request));
    this.register("agent_message", (request) => this.collaboration(request, "messages"));
    this.register("finish_collaboration", (request) => this.collaboration(request, "finish"));
    this.register("view_image", (request) => executeViewImage(
      request.arguments as ViewImageArguments & { projectId: string },
      this.options.workspaceRoot,
      this.options.attachmentPaths,
    ));
    this.register("search_capabilities", (request) =>
      searchCapabilities(String((request.arguments as { query?: string }).query ?? "")));
    this.register("load_capability", (request) =>
      loadCapability(String((request.arguments as { id?: string }).id ?? "")));
    for (const name of FILE_TOOLS) {
      this.register(name, (request) =>
        this.executeFile(request, this.options.workspaceRoot, this.options.executionContext));
    }
    this.register("terminal", (request) => this.executeTerminal(
      request.arguments as TerminalAction,
      this.options.workspaceRoot,
      this.options.executionContext,
    ));
  }

  register(name: string, handler: ToolHandler): void {
    if (!name || this.handlers.has(name)) throw new Error(`tool_already_registered:${name}`);
    this.handlers.set(name, handler);
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

  close(): void {
    for (const terminalId of this.leasedTerminalIds) {
      terminalWriteLeases.get(terminalId)?.();
      terminalWriteLeases.delete(terminalId);
    }
    this.leasedTerminalIds.clear();
  }

  private async dispatch(request: ToolRequestEvent): Promise<unknown> {
    if (request.tool.startsWith("mcp__")) {
      return executeMcpCapability(request.tool, request.arguments as Record<string, unknown>);
    }
    const handler = this.handlers.get(request.tool);
    if (!handler) throw new Error(`unknown_tool:${request.tool}`);
    return handler(request);
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
        request.arguments as FileToolRequest,
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
    action: TerminalAction,
    workspaceRoot?: string,
    executionContext?: DesktopExecutionContext,
  ): Promise<unknown> {
    let release: (() => void) | undefined;
    if (executionContext && action.action === "start" && action.intent !== "read") {
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
      result = await executeTerminalAction(action, this.options.execution.signal, workspaceRoot);
    } catch (error) {
      release?.();
      throw error;
    }
    const items = Array.isArray(result) ? result : [result];
    if (action.action === "start") {
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
import type { AgentStreamEvent, AgentTask, ToolRequestEvent } from "@ohmycode/agent-runtime";
import type { ToolExecutor, ToolResult } from "@ohmycode/tool-contracts";
