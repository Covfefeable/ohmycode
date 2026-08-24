import path from "node:path";
import { dialog } from "electron";
import { apiRequest } from "../api/api-client.js";
import { stopMessage, streamMessage, type ConversationStreamEvent } from "../conversations/conversation-service.js";
import type { MultiAgentSummary, MultiAgentTask } from "./types.js";

export type MultiAgentRunEvent =
  | { type: "task.updated"; task: MultiAgentTask }
  | { type: "node.event"; nodeId: string; event: ConversationStreamEvent }
  | { type: "task.failed"; error: string };

type ActiveTaskRun = { taskId: string; nodeRequestIds: Set<string>; cancelled: boolean };
const activeTaskRuns = new Map<string, ActiveTaskRun>();

export function listMultiAgents(): Promise<MultiAgentSummary[]> {
  return apiRequest("/api/multi-agents");
}

export async function createMultiAgent(): Promise<MultiAgentSummary | null> {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  const workspacePath = path.resolve(result.filePaths[0]);
  return apiRequest("/api/multi-agents", {
    method: "POST",
    body: JSON.stringify({ name: path.basename(workspacePath), workspacePath }),
  });
}

export function deleteMultiAgent(agentId: string): Promise<void> {
  return apiRequest(`/api/multi-agents/${agentId}`, { method: "DELETE" });
}

export function planMultiAgentTask(agentId: string, request: string, modelId?: string): Promise<MultiAgentTask> {
  return apiRequest(`/api/multi-agents/${agentId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ request, modelId }),
  });
}

export function getMultiAgentTask(taskId: string): Promise<MultiAgentTask> {
  return apiRequest(`/api/multi-agents/tasks/${taskId}`);
}

export function saveMultiAgentFlow(taskId: string, positions: Record<string, { x: number; y: number }>): Promise<MultiAgentTask> {
  return apiRequest(`/api/multi-agents/tasks/${taskId}/flow`, {
    method: "PATCH",
    body: JSON.stringify({ positions }),
  });
}

export function deleteMultiAgentTask(taskId: string): Promise<void> {
  return apiRequest(`/api/multi-agents/tasks/${taskId}`, { method: "DELETE" });
}

async function runNode(
  taskId: string,
  nodeId: string,
  requestId: string,
  workspacePath: string,
  onEvent: (event: MultiAgentRunEvent) => void,
): Promise<MultiAgentTask> {
  const started = await apiRequest<{ conversationId: string; prompt: string }>(`/api/multi-agents/nodes/${nodeId}/start`, { method: "POST" });
  onEvent({ type: "task.updated", task: await getMultiAgentTask(taskId) });
  const nodeRequestId = `${requestId}:${nodeId}`;
  activeTaskRuns.get(requestId)?.nodeRequestIds.add(nodeRequestId);
  try {
    const conversation = await streamMessage(
      started.conversationId,
      started.prompt,
      undefined,
      undefined,
      nodeRequestId,
      (event) => onEvent({ type: "node.event", nodeId, event }),
      { ownerId: nodeId, workspacePath },
    );
    const answer = [...(conversation.messages ?? [])].reverse().find((message) => message.role === "assistant");
    if (activeTaskRuns.get(requestId)?.cancelled) throw new Error("task_stopped");
    if (!answer?.content.trim()) throw new Error("node_returned_no_output");
    const completed = await apiRequest<MultiAgentTask>(`/api/multi-agents/nodes/${nodeId}/complete`, {
      method: "POST",
      body: JSON.stringify({ output: { content: answer.content, reasoning: answer.reasoning, activity: answer.activity } }),
    });
    onEvent({ type: "task.updated", task: completed });
    return completed;
  } catch (error) {
    if (!activeTaskRuns.get(requestId)?.cancelled) {
      await apiRequest(`/api/multi-agents/nodes/${nodeId}/fail`, {
        method: "POST",
        body: JSON.stringify({ errorCode: error instanceof Error ? error.message : "node_failed" }),
      });
    }
    throw error;
  } finally {
    activeTaskRuns.get(requestId)?.nodeRequestIds.delete(nodeRequestId);
  }
}

export async function runMultiAgentTask(
  taskId: string,
  requestId: string,
  onEvent: (event: MultiAgentRunEvent) => void,
): Promise<MultiAgentTask> {
  activeTaskRuns.set(requestId, { taskId, nodeRequestIds: new Set(), cancelled: false });
  try {
    let task = await apiRequest<MultiAgentTask>(`/api/multi-agents/tasks/${taskId}/start`, { method: "POST" });
    onEvent({ type: "task.updated", task });
    while (task.status === "running") {
      const ready = task.nodes.filter((node) => node.status === "ready");
      if (!ready.length) throw new Error("workflow_has_no_runnable_nodes");
      const results = await Promise.all(ready.map((node) => runNode(task.id, node.id, requestId, task.workspacePath, onEvent)));
      task = results.at(-1) ?? await getMultiAgentTask(task.id);
      onEvent({ type: "task.updated", task });
    }
    return task;
  } catch (error) {
    if (!activeTaskRuns.get(requestId)?.cancelled) {
      onEvent({ type: "task.failed", error: error instanceof Error ? error.message : "task_failed" });
    }
    throw error;
  } finally {
    activeTaskRuns.delete(requestId);
  }
}

export async function stopMultiAgentTask(requestId: string): Promise<void> {
  const active = activeTaskRuns.get(requestId);
  if (!active) return;
  active.cancelled = true;
  const requests = [...active.nodeRequestIds];
  await Promise.allSettled(requests.map((nodeRequestId) => stopMessage(nodeRequestId)));
  await apiRequest(`/api/multi-agents/tasks/${active.taskId}/stop`, { method: "POST" });
}
