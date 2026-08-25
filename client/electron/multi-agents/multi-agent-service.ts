import path from "node:path";
import { dialog } from "electron";
import { apiRequest } from "../api/api-client.js";
import { stopMessage, streamMessage, type ConversationStreamEvent } from "../conversations/conversation-service.js";
import type { MultiAgentSummary, MultiAgentTask } from "./types.js";

export type MultiAgentRunEvent =
  | { type: "task.updated"; task: MultiAgentTask }
  | { type: "node.event"; nodeId: string; event: ConversationStreamEvent }
  | { type: "task.failed"; error: string };

type ActiveRun = { taskId: string; nodeRequestId?: string; cancelled: boolean };
const activeRuns = new Map<string, ActiveRun>();

export const listMultiAgents = (): Promise<MultiAgentSummary[]> => apiRequest("/api/multi-agents");
export const createMultiAgent = (payload: { name: string; description: string; division: string }): Promise<MultiAgentSummary> => apiRequest("/api/multi-agents", { method: "POST", body: JSON.stringify(payload) });
export const updateMultiAgent = (agentId: string, payload: Partial<MultiAgentSummary>): Promise<MultiAgentSummary> => apiRequest(`/api/multi-agents/${agentId}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteMultiAgent = (agentId: string): Promise<void> => apiRequest(`/api/multi-agents/${agentId}`, { method: "DELETE" });
export async function selectMultiAgentWorkspace(): Promise<string | null> { const result = await dialog.showOpenDialog({ properties: ["openDirectory"] }); return result.canceled || !result.filePaths[0] ? null : path.resolve(result.filePaths[0]); }
export const createMultiAgentTask = (agentId: string, request: string, workspacePath: string): Promise<MultiAgentTask> => apiRequest(`/api/multi-agents/${agentId}/tasks`, { method: "POST", body: JSON.stringify({ request: request.trim(), workspacePath: path.resolve(workspacePath) }) });
export const getMultiAgentTask = (taskId: string): Promise<MultiAgentTask> => apiRequest(`/api/multi-agents/tasks/${taskId}`);
export const deleteMultiAgentTask = (taskId: string): Promise<void> => apiRequest(`/api/multi-agents/tasks/${taskId}`, { method: "DELETE" });

async function runTurn(task: MultiAgentTask, memberId: string, requestId: string, onEvent: (event: MultiAgentRunEvent) => void): Promise<MultiAgentTask> {
  const member = task.members.find((item) => item.id === memberId);
  if (!member) throw new Error("speaker_not_found");
  const started = await apiRequest<{ conversationId: string; prompt: string; modelId?: string | null }>(`/api/multi-agents/nodes/${member.id}/start`, { method: "POST" });
  const nodeRequestId = `${requestId}:${member.id}:${crypto.randomUUID()}`;
  const active = activeRuns.get(requestId);
  if (active) active.nodeRequestId = nodeRequestId;
  let handedOff = false;
  let streamError: string | undefined;
  let transportError: unknown;
  let conversation;
  try {
    conversation = await streamMessage(started.conversationId, started.prompt, started.modelId ?? undefined, undefined, nodeRequestId, (event) => {
      onEvent({ type: "node.event", nodeId: member.id, event });
      if (event.type === "run.failed") streamError = event.errorCode;
      if (event.type === "tool.completed") {
        const result = event.result as { sourceStatus?: string; status?: string };
        if (result?.sourceStatus === "idle" || result?.status === "completed") {
          handedOff = true;
          void stopMessage(nodeRequestId);
        }
        void getMultiAgentTask(task.id).then((latest) => onEvent({ type: "task.updated", task: latest }));
      }
    }, { ownerId: member.id, workspacePath: task.workspacePath });
  } catch (error) {
    transportError = error;
  } finally {
    if (active) active.nodeRequestId = undefined;
  }
  let latest = await getMultiAgentTask(task.id);
  if (transportError) {
    const latestMember = latest.members.find((item) => item.id === member.id);
    if (latest.status === "running" && latestMember?.status === "running") {
      const message = transportError instanceof Error ? transportError.message : "connection_closed";
      latest = await apiRequest(`/api/multi-agents/nodes/${member.id}/fail`, {
        method: "POST",
        body: JSON.stringify({ errorCode: `stream_transport_${message}`.slice(0, 500) }),
      });
    }
    onEvent({ type: "task.updated", task: latest });
    return latest;
  }
  if (streamError) {
    latest = await apiRequest(`/api/multi-agents/nodes/${member.id}/fail`, {
      method: "POST",
      body: JSON.stringify({ errorCode: streamError }),
    });
    onEvent({ type: "task.updated", task: latest });
    return latest;
  }
  if (!handedOff && latest.status === "running" && latest.members.find((item) => item.id === member.id)?.status === "running") {
    const answer = [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "assistant");
    latest = await apiRequest(`/api/multi-agents/nodes/${member.id}/complete`, { method: "POST", body: JSON.stringify({ output: { content: answer?.content ?? "" } }) });
  }
  onEvent({ type: "task.updated", task: latest });
  return latest;
}

async function orchestrate(task: MultiAgentTask, requestId: string, onEvent: (event: MultiAgentRunEvent) => void): Promise<MultiAgentTask> {
  while (task.status === "running") {
    if (activeRuns.get(requestId)?.cancelled) return getMultiAgentTask(task.id);
    let speaker = task.members.find((item) => item.status === "ready");
    if (!speaker) {
      task = await apiRequest(`/api/multi-agents/tasks/${task.id}/recover-host`, { method: "POST" });
      speaker = task.members.find((item) => item.status === "ready");
    }
    if (!speaker) throw new Error("collaboration_has_no_speaker");
    task = await runTurn(task, speaker.id, requestId, onEvent);
  }
  return task;
}

export async function runMultiAgentTask(taskId: string, requestId: string, onEvent: (event: MultiAgentRunEvent) => void): Promise<MultiAgentTask> {
  activeRuns.set(requestId, { taskId, cancelled: false });
  try {
    const started = await apiRequest<MultiAgentTask>(`/api/multi-agents/tasks/${taskId}/start`, { method: "POST" });
    onEvent({ type: "task.updated", task: started });
    return await orchestrate(started, requestId, onEvent);
  } catch (error) {
    if (activeRuns.get(requestId)?.cancelled) return getMultiAgentTask(taskId);
    const message = error instanceof Error ? error.message : "collaboration_failed";
    onEvent({ type: "task.failed", error: message });
    throw error;
  } finally { activeRuns.delete(requestId); }
}

export async function stopMultiAgentTask(requestId: string | null, taskId?: string): Promise<void> {
  const active = requestId ? activeRuns.get(requestId) : undefined;
  const targetTaskId = active?.taskId ?? taskId;
  if (!targetTaskId) return;
  if (active) active.cancelled = true;
  await apiRequest(`/api/multi-agents/tasks/${targetTaskId}/stop`, { method: "POST" });
  if (active?.nodeRequestId) await stopMessage(active.nodeRequestId);
}

export async function sendCollaborationMessage(taskId: string, memberId: string, content: string): Promise<MultiAgentTask> {
  await apiRequest(`/api/multi-agents/nodes/${memberId}/user-messages`, { method: "POST", body: JSON.stringify({ content }) });
  return getMultiAgentTask(taskId);
}
