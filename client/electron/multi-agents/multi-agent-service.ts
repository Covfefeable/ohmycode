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
const activeNodeAdjustments = new Map<string, string[]>();

export function listMultiAgents(): Promise<MultiAgentSummary[]> {
  return apiRequest("/api/multi-agents");
}

export async function createMultiAgent(payload: { name: string; description: string; division: string }): Promise<MultiAgentSummary> {
  return apiRequest("/api/multi-agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMultiAgent(agentId: string, payload: Partial<MultiAgentSummary>): Promise<MultiAgentSummary> {
  return apiRequest(`/api/multi-agents/${agentId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMultiAgent(agentId: string): Promise<void> {
  return apiRequest(`/api/multi-agents/${agentId}`, { method: "DELETE" });
}

export async function selectMultiAgentWorkspace(): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled || !result.filePaths[0]) return null;
  return path.resolve(result.filePaths[0]);
}

export async function createMultiAgentTask(agentId: string, request: string, workspacePath: string): Promise<MultiAgentTask> {
  return apiRequest(`/api/multi-agents/${agentId}/tasks`, {
    method: "POST",
    body: JSON.stringify({ workspacePath: path.resolve(workspacePath), request: request.trim() }),
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
  const started = await apiRequest<{ conversationId: string; prompt: string; modelId?: string | null }>(`/api/multi-agents/nodes/${nodeId}/start`, { method: "POST" });
  onEvent({ type: "task.updated", task: await getMultiAgentTask(taskId) });
  const nodeRequestId = `${requestId}:${nodeId}`;
  activeTaskRuns.get(requestId)?.nodeRequestIds.add(nodeRequestId);
  activeNodeAdjustments.set(nodeId, []);
  const agentMessageCalls = new Set<string>();
  try {
    let prompt = started.prompt;
    let conversation;
    while (true) {
      conversation = await streamMessage(started.conversationId, prompt, started.modelId ?? undefined, undefined, nodeRequestId,
        (event) => {
          if (event.type === "tool.requested" && event.tool === "agent_message") agentMessageCalls.add(event.callId);
          onEvent({ type: "node.event", nodeId, event });
          if (event.type === "tool.completed" && agentMessageCalls.delete(event.callId)) void getMultiAgentTask(taskId).then((value) => onEvent({ type: "task.updated", task: value }));
        }, { ownerId: nodeId, workspacePath });
      const adjustments = activeNodeAdjustments.get(nodeId)?.splice(0) ?? [];
      if (!adjustments.length) break;
      prompt = `The user adjusted your current task while you were working:\n\n${adjustments.join("\n\n")}\n\nContinue from the existing conversation. Revise your result as needed and notify affected agents with agent_message when appropriate.`;
    }
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
    activeNodeAdjustments.delete(nodeId);
    activeTaskRuns.get(requestId)?.nodeRequestIds.delete(nodeRequestId);
  }
}

export async function adjustMultiAgentNode(
  taskId: string,
  nodeId: string,
  content: string,
  requestId: string,
  onEvent: (event: MultiAgentRunEvent) => void,
): Promise<MultiAgentTask> {
  const queue = activeNodeAdjustments.get(nodeId);
  if (queue) {
    queue.push(content.trim());
    return getMultiAgentTask(taskId);
  }
  const task = await getMultiAgentTask(taskId);
  const node = task.nodes.find((item) => item.id === nodeId);
  if (!node || node.status !== "completed" || !node.conversationId) throw new Error("node_not_adjustable");
  const awakened = await apiRequest<{ conversationId: string; modelId?: string | null }>(`/api/multi-agents/nodes/${nodeId}/wake`, { method: "POST" });
  onEvent({ type: "task.updated", task: await getMultiAgentTask(taskId) });
  const agentMessageCalls = new Set<string>();
  const conversation = await streamMessage(awakened.conversationId, content.trim(), awakened.modelId ?? undefined, undefined, requestId,
    (event) => {
      if (event.type === "tool.requested" && event.tool === "agent_message") agentMessageCalls.add(event.callId);
      onEvent({ type: "node.event", nodeId, event });
      if (event.type === "tool.completed" && agentMessageCalls.delete(event.callId)) void getMultiAgentTask(taskId).then((value) => onEvent({ type: "task.updated", task: value }));
    }, { ownerId: nodeId, workspacePath: task.workspacePath });
  const answer = [...(conversation.messages ?? [])].reverse().find((message) => message.role === "assistant");
  if (!answer?.content.trim()) throw new Error("node_returned_no_output");
  const completed = await apiRequest<MultiAgentTask>(`/api/multi-agents/nodes/${nodeId}/complete`, {
    method: "POST", body: JSON.stringify({ output: { content: answer.content, reasoning: answer.reasoning, activity: answer.activity } }),
  });
  onEvent({ type: "task.updated", task: completed });
  return completed;
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
    if (activeTaskRuns.get(requestId)?.cancelled) return getMultiAgentTask(taskId);
    onEvent({ type: "task.failed", error: error instanceof Error ? error.message : "task_failed" });
    throw error;
  } finally {
    activeTaskRuns.delete(requestId);
  }
}

export async function stopMultiAgentTask(requestId: string): Promise<void> {
  const active = activeTaskRuns.get(requestId);
  if (!active) return;
  active.cancelled = true;
  await apiRequest(`/api/multi-agents/tasks/${active.taskId}/stop`, { method: "POST" });
  const requests = [...active.nodeRequestIds];
  await Promise.allSettled(requests.map((nodeRequestId) => stopMessage(nodeRequestId)));
}
