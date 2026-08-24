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
const queuedNodeMessages = new Map<string, string[]>();

function queueNodeMessage(nodeId: string, content: string): void {
  const active = activeNodeAdjustments.get(nodeId);
  if (active) active.push(content);
  else queuedNodeMessages.set(nodeId, [...(queuedNodeMessages.get(nodeId) ?? []), content]);
}

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
  node: MultiAgentTask["nodes"][number],
  requestId: string,
  workspacePath: string,
  onEvent: (event: MultiAgentRunEvent) => void,
): Promise<MultiAgentTask> {
  const nodeId = node.id;
  const queued = queuedNodeMessages.get(nodeId) ?? [];
  queuedNodeMessages.delete(nodeId);
  const persistedMessage = [...node.messages].reverse().find((message) => message.toNodeId === nodeId);
  const deliveredMessages = queued.length
    ? queued
    : persistedMessage ? [`Message from workflow agent ${persistedMessage.fromNodeId ?? "user"}:\n${persistedMessage.content}`] : [];
  const continuing = node.status === "running" && Boolean(node.conversationId) && deliveredMessages.length > 0;
  const started = continuing
    ? {
        conversationId: node.conversationId!,
        modelId: node.modelId,
        prompt: `Another workflow agent sent you the following message:\n\n${deliveredMessages.join("\n\n")}\n\nContinue from the existing conversation. Apply the message and use agent_message to report the result or ask for clarification when appropriate.`,
      }
    : await apiRequest<{ conversationId: string; prompt: string; modelId?: string | null }>(`/api/multi-agents/nodes/${nodeId}/start`, { method: "POST" });
  onEvent({ type: "task.updated", task: await getMultiAgentTask(taskId) });
  const nodeRequestId = `${requestId}:${nodeId}`;
  activeTaskRuns.get(requestId)?.nodeRequestIds.add(nodeRequestId);
  activeNodeAdjustments.set(nodeId, []);
  const agentMessageCalls = new Set<string>();
  const agentMessageRequests = new Map<string, { toNodeId: string; content: string }>();
  let pausedForReply = false;
  try {
    let prompt = started.prompt;
    let conversation;
    while (true) {
      conversation = await streamMessage(started.conversationId, prompt, started.modelId ?? undefined, undefined, nodeRequestId,
        (event) => {
          if (event.type === "tool.requested" && event.tool === "agent_message") {
            agentMessageCalls.add(event.callId);
            agentMessageRequests.set(event.callId, event.arguments as { toNodeId: string; content: string });
          }
          onEvent({ type: "node.event", nodeId, event });
          if (event.type === "tool.completed" && agentMessageCalls.delete(event.callId)) {
            const result = event.result as { sourceStatus?: string };
            if (result?.sourceStatus === "paused") {
              pausedForReply = true;
              void stopMessage(nodeRequestId);
            }
            const sent = agentMessageRequests.get(event.callId);
            if (sent) queueNodeMessage(sent.toNodeId, `Message from workflow agent ${nodeId}:\n${sent.content}`);
            agentMessageRequests.delete(event.callId);
            void getMultiAgentTask(taskId).then((value) => onEvent({ type: "task.updated", task: value }));
          }
        }, { ownerId: nodeId, workspacePath });
      await new Promise((resolve) => setTimeout(resolve, 50));
      const adjustments = activeNodeAdjustments.get(nodeId)?.splice(0) ?? [];
      if (!adjustments.length) break;
      prompt = `The user adjusted your current task while you were working:\n\n${adjustments.join("\n\n")}\n\nContinue from the existing conversation. Revise your result as needed and notify affected agents with agent_message when appropriate.`;
    }
    const latestTask = await getMultiAgentTask(taskId);
    const latestNode = latestTask.nodes.find((item) => item.id === nodeId);
    if (pausedForReply || latestNode?.status === "paused") return latestTask;
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
      const latest = await getMultiAgentTask(taskId).catch(() => null);
      const currentNode = latest?.nodes.find((item) => item.id === nodeId);
      if (latest && currentNode?.status === "paused") return latest;
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
  await apiRequest(`/api/multi-agents/nodes/${nodeId}/user-messages`, {
    method: "POST", body: JSON.stringify({ content }),
  });
  const queue = activeNodeAdjustments.get(nodeId);
  if (queue) {
    queue.push(content.trim());
    return getMultiAgentTask(taskId);
  }
  const task = await getMultiAgentTask(taskId);
  const node = task.nodes.find((item) => item.id === nodeId);
  if (!node || !["completed", "paused"].includes(node.status) || !node.conversationId) throw new Error("node_not_adjustable");
  const awakened = await apiRequest<{ conversationId: string; modelId?: string | null }>(`/api/multi-agents/nodes/${nodeId}/wake`, { method: "POST" });
  onEvent({ type: "task.updated", task: await getMultiAgentTask(taskId) });
  const agentMessageCalls = new Set<string>();
  const agentMessageRequests = new Map<string, { toNodeId: string; content: string }>();
  const conversation = await streamMessage(awakened.conversationId, content.trim(), awakened.modelId ?? undefined, undefined, requestId,
    (event) => {
      if (event.type === "tool.requested" && event.tool === "agent_message") {
        agentMessageCalls.add(event.callId);
        agentMessageRequests.set(event.callId, event.arguments as { toNodeId: string; content: string });
      }
      onEvent({ type: "node.event", nodeId, event });
      if (event.type === "tool.completed" && agentMessageCalls.delete(event.callId)) {
        const sent = agentMessageRequests.get(event.callId);
        if (sent) queueNodeMessage(sent.toNodeId, `Message from workflow agent ${nodeId}:\n${sent.content}`);
        agentMessageRequests.delete(event.callId);
        void getMultiAgentTask(taskId).then((value) => onEvent({ type: "task.updated", task: value }));
      }
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
    let task = await getMultiAgentTask(taskId);
    if (task.status === "running") throw new Error("workflow_already_running");
    task = await apiRequest<MultiAgentTask>(`/api/multi-agents/tasks/${taskId}/start`, { method: "POST" });
    onEvent({ type: "task.updated", task });
    while (task.status === "running") {
      const ready = task.nodes.filter((node) =>
        node.status === "ready" || (node.status === "running" && Boolean(node.finalOutput)
          && (queuedNodeMessages.has(node.id) || node.messages.some((message) => message.toNodeId === node.id))),
      );
      if (!ready.length) {
        const waiting = task.nodes.some((node) => ["pending", "paused", "running"].includes(node.status));
        if (!waiting) throw new Error("workflow_has_no_runnable_nodes");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        task = await getMultiAgentTask(task.id);
        onEvent({ type: "task.updated", task });
        continue;
      }
      const results = await Promise.all(ready.map((node) => runNode(task.id, node, requestId, task.workspacePath, onEvent)));
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

export async function stopMultiAgentTask(requestId: string | null, taskId?: string): Promise<void> {
  if (!requestId && taskId) {
    await apiRequest(`/api/multi-agents/tasks/${taskId}/stop`, { method: "POST" });
    return;
  }
  if (!requestId) return;
  const active = activeTaskRuns.get(requestId);
  if (!active) return;
  active.cancelled = true;
  await apiRequest(`/api/multi-agents/tasks/${active.taskId}/stop`, { method: "POST" });
  const requests = [...active.nodeRequestIds];
  await Promise.allSettled(requests.map((nodeRequestId) => stopMessage(nodeRequestId)));
}
