import { ApiError, apiErrorFromResponse, apiFetch, apiRequest } from "../api/api-client.js";
import type { LocalConversation } from "../projects/types.js";
import type { MessageAttachment } from "../projects/types.js";
import { executeTerminalAction } from "../terminal/terminal-manager.js";
import type { TerminalAction } from "../terminal/types.js";
import { acquireWorkspaceWriteLock } from "../multi-agents/workspace-write-lock.js";
import { recordWorkspaceChanges, snapshotWorkspace } from "../multi-agents/workspace-changes.js";
import { executeFileTool } from "../files/file-tools.js";
import { executeViewImage, type ViewImageArguments } from "../files/image-tool.js";
import { loadAgentInstructions, renderAgentInstructions } from "../files/agents-instructions.js";
import type { FileToolName, FileToolRequest } from "../files/types.js";
import type { TurnExecution } from "../runtime/turn-execution.js";
import { listProjects } from "../projects/projects-service.js";
import { executeMcpCapability, loadCapability, searchCapabilities } from "../capabilities/capability-manager.js";
import {
  forwardServerStream,
  type AgentTask,
  type ConversationStreamEvent,
  type ToolRequestEvent,
} from "./server-stream.js";

export type { AgentTask, ConversationStreamEvent } from "./server-stream.js";
type ActiveRequest = {
  inspectedPaths: Set<string>;
  failedToolCalls: Map<string, number>;
  attachmentPaths: Set<string>;
  leasedTerminalIds: Set<string>;
};
export type AgentExecutionContext = { ownerId: string; workspacePath: string };
const terminalWriteLeases = new Map<string, () => void>();

async function conversationWorkspace(conversationId: string, executionContext?: AgentExecutionContext): Promise<string | undefined> {
  if (executionContext) return executionContext.workspacePath;
  const project = (await listProjects()).find((item) => item.conversations.some((conversation) => conversation.id === conversationId));
  return project?.path;
}

function toolError(error: unknown): { error: string; code?: string } {
  if (error instanceof ApiError && error.code === "agent_cannot_schedule_itself") {
    return { code: error.code, error: "You cannot hand the collaboration turn to yourself. Choose another member." };
  }
  return { error: error instanceof Error ? error.message : "tool_failed" };
}

function toolSignature(request: ToolRequestEvent): string {
  const sortValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sortValue);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sortValue(item)]));
    }
    return value;
  };
  return `${request.tool}:${JSON.stringify(sortValue(request.arguments))}`;
}

export async function streamMessage(
  conversationId: string,
  content: string,
  modelId: string | undefined,
  editMessageId: string | undefined,
  attachments: MessageAttachment[] | undefined,
  onEvent: (event: ConversationStreamEvent) => void,
  execution: TurnExecution,
  executionContext?: AgentExecutionContext,
  turnId?: string,
): Promise<LocalConversation> {
  const active: ActiveRequest = {
    inspectedPaths: new Set(),
    failedToolCalls: new Map(),
    attachmentPaths: new Set((attachments ?? []).map((item) => item.path)),
    leasedTerminalIds: new Set(),
  };
  try {
    const workspaceRoot = await conversationWorkspace(conversationId, executionContext);
    const workspaceInstructions = workspaceRoot
      ? renderAgentInstructions(await loadAgentInstructions(workspaceRoot))
      : "";
    let response = await apiFetch(`/api/projects/conversations/${conversationId}/stream`, {
      method: "POST",
      body: JSON.stringify({ content, modelId, editMessageId, attachments, workspaceInstructions, turnId }),
      signal: execution.signal,
    });
    if (!response.ok) throw await apiErrorFromResponse(response);
    while (true) {
      const requests = await forwardServerStream(response, (event) => {
        if (event.type === "run.started") execution.setRemoteRunId(event.runId);
        onEvent(event);
      });
      if (requests.length === 0 || execution.signal.aborted) break;
      const results = await Promise.all(requests.map(async (request) => {
        const signature = toolSignature(request);
        try {
          if ((active.failedToolCalls.get(signature) ?? 0) >= 2) {
            throw new Error("repeated_failed_tool_call: this exact operation has already failed twice; diagnose the cause and choose a different approach");
          }
          if (request.tool === "update_tasks") {
            const tasks = (request.arguments as { tasks?: AgentTask[] }).tasks;
            const valid = Array.isArray(tasks)
              && tasks.length <= 20
              && new Set(tasks.map((task) => task.id)).size === tasks.length
              && tasks.filter((task) => task.status === "in_progress").length <= 1
              && tasks.every((task) => task.id?.trim() && task.id.length <= 80
                && task.content?.trim() && task.content.length <= 300
                && ["pending", "in_progress", "completed"].includes(task.status));
            const result = valid ? { updated: true, taskCount: tasks.length } : { error: "invalid_task_plan" };
            onEvent({ type: "tool.completed", callId: request.callId, result });
            return { callId: request.callId, result };
          }
          if (request.tool === "agent_message") {
            if (!executionContext) throw new Error("agent_message_unavailable");
            const result = await apiRequest(`/api/multi-agents/nodes/${executionContext.ownerId}/messages`, {
              method: "POST",
              body: JSON.stringify(request.arguments),
            });
            onEvent({ type: "tool.completed", callId: request.callId, result });
            active.failedToolCalls.delete(signature);
            return { callId: request.callId, result };
          }
          if (request.tool === "finish_collaboration") {
            if (!executionContext) throw new Error("finish_collaboration_unavailable");
            const result = await apiRequest(`/api/multi-agents/nodes/${executionContext.ownerId}/finish`, {
              method: "POST",
              body: JSON.stringify(request.arguments),
            });
            onEvent({ type: "tool.completed", callId: request.callId, result });
            active.failedToolCalls.delete(signature);
            return { callId: request.callId, result };
          }
          if (request.tool === "view_image") {
            const result = await executeViewImage(request.arguments as ViewImageArguments & { projectId: string }, workspaceRoot, active.attachmentPaths);
            onEvent({ type: "tool.completed", callId: request.callId, result });
            active.failedToolCalls.delete(signature);
            return { callId: request.callId, result };
          }
          if (request.tool === "search_capabilities") {
            const result = await searchCapabilities(String((request.arguments as { query?: string }).query ?? ""));
            onEvent({ type: "tool.completed", callId: request.callId, result });
            return { callId: request.callId, result };
          }
          if (request.tool === "load_capability") {
            const result = await loadCapability(String((request.arguments as { id?: string }).id ?? ""));
            onEvent({ type: "tool.completed", callId: request.callId, result });
            return { callId: request.callId, result };
          }
          if (request.tool.startsWith("mcp__")) {
            const result = await executeMcpCapability(request.tool, request.arguments as Record<string, unknown>);
            onEvent({ type: "tool.completed", callId: request.callId, result });
            return { callId: request.callId, result };
          }
          if (["read_file", "search_files", "list_directory", "apply_patch"].includes(request.tool)) {
            let release: (() => void) | undefined;
            if (executionContext && request.tool === "apply_patch") {
              const unlock = await acquireWorkspaceWriteLock(executionContext.workspacePath, executionContext.ownerId);
              const before = snapshotWorkspace(executionContext.workspacePath);
              release = () => { void recordWorkspaceChanges(executionContext.ownerId, executionContext.workspacePath, before).finally(unlock); };
            }
            try {
              const result = await executeFileTool(request.tool as FileToolName, request.arguments as FileToolRequest, workspaceRoot, active.inspectedPaths, active.attachmentPaths);
              if (request.tool === "read_file") active.inspectedPaths.add(result.path);
              release?.();
              onEvent({ type: "tool.completed", callId: request.callId, result });
              active.failedToolCalls.delete(signature);
              return { callId: request.callId, result };
            } catch (error) {
              release?.();
              throw error;
            }
          }
          const terminalAction = request.arguments as TerminalAction;
          let release: (() => void) | undefined;
          if (executionContext && terminalAction.action === "start" && terminalAction.intent !== "read") {
            const unlock = await acquireWorkspaceWriteLock(executionContext.workspacePath, executionContext.ownerId);
            const before = snapshotWorkspace(executionContext.workspacePath);
            release = () => {
              void recordWorkspaceChanges(executionContext.ownerId, executionContext.workspacePath, before)
                .finally(unlock);
            };
          }
          let result;
          try {
            result = await executeTerminalAction(terminalAction, execution.signal, executionContext?.workspacePath);
          } catch (error) {
            release?.();
            throw error;
          }
          const items = Array.isArray(result) ? result : [result];
          if (terminalAction.action === "start") {
            for (const item of items) if (item.terminalId) execution.registerTerminal(item.terminalId);
          }
          if (release) {
            const running = items.find((item) => item.status === "running");
            if (running) {
              terminalWriteLeases.set(running.terminalId, release);
              active.leasedTerminalIds.add(running.terminalId);
            }
            else release();
          }
          for (const item of items) {
            if (item.status !== "running") {
              terminalWriteLeases.get(item.terminalId)?.();
              terminalWriteLeases.delete(item.terminalId);
              active.leasedTerminalIds.delete(item.terminalId);
            }
          }
          onEvent({ type: "tool.completed", callId: request.callId, result });
          active.failedToolCalls.delete(signature);
          return { callId: request.callId, result };
        } catch (error) {
          active.failedToolCalls.set(signature, (active.failedToolCalls.get(signature) ?? 0) + 1);
          const result = toolError(error);
          onEvent({ type: "tool.completed", callId: request.callId, result });
          return { callId: request.callId, result };
        }
      }));
      if (execution.signal.aborted) break;
      response = await apiFetch(`/api/agent-runs/${requests[0].runId}/resume`, {
        method: "POST",
        body: JSON.stringify({ results, workspaceInstructions }),
        signal: execution.signal,
      });
      if (!response.ok) throw await apiErrorFromResponse(response);
    }
  } catch (error) {
    if (!execution.signal.aborted) throw error;
  } finally {
    for (const terminalId of active.leasedTerminalIds) {
      terminalWriteLeases.get(terminalId)?.();
      terminalWriteLeases.delete(terminalId);
    }
  }
  return apiRequest(`/api/projects/conversations/${conversationId}`);
}
