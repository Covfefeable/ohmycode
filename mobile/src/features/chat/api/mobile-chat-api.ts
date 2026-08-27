import { runToolLoop, type AgentStreamEvent } from "@ohmycode/agent-runtime";

import { ApiError, authenticatedFetch, authenticatedRequest } from "@/shared/api/api-client";

export type MobileMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
  reasoning?: string | null;
  activity?: MobileActivityStep[] | null;
  agentDurationMs?: number | null;
  agentStartedAt?: string;
};

export type MobileActivityStep =
  | { id: string; type: "run"; status: "running" | "completed" }
  | { id: string; type: "reasoning" | "message"; content: string; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "tool"; tool: string; input: unknown; result?: unknown; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "task_plan"; tasks: { id: string; content: string; status: "pending" | "in_progress" | "completed" }[] };

export type MobileConversation = {
  id: string;
  title: string;
  createdAt?: string;
  messages?: MobileMessage[];
};

function turnId(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

export function listMobileConversations(): Promise<MobileConversation[]> {
  return authenticatedRequest("/api/mobile/conversations");
}

export function createMobileConversation(): Promise<MobileConversation> {
  return authenticatedRequest("/api/mobile/conversations", {
    method: "POST",
    body: JSON.stringify({ title: "New conversation" }),
  });
}

export function getMobileConversation(id: string): Promise<MobileConversation> {
  return authenticatedRequest(`/api/mobile/conversations/${id}`);
}

export function cancelMobileRun(runId: string, partialMessage: string): Promise<void> {
  return authenticatedRequest(`/api/mobile/conversations/runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ partialMessage }),
  });
}

export async function streamMobileMessage(
  id: string,
  content: string,
  signal: AbortSignal,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<void> {
  const localTurnId = turnId();
  const response = await authenticatedFetch(`/api/mobile/conversations/${id}/stream`, {
    method: "POST",
    body: JSON.stringify({ content, turnId: localTurnId }),
    signal,
  });
  const postRun = (runId: string, action: "recover" | "resume", payload: object) => authenticatedFetch(
    `/api/mobile/conversations/runs/${runId}/${action}`,
    { method: "POST", body: JSON.stringify(payload), signal },
  );
  let failedCode = "";
  await runToolLoop({
    response,
    runId: localTurnId,
    workspaceInstructions: "",
    execution: {
      signal,
      setPendingToolCalls: () => undefined,
      setPhase: () => undefined,
    },
    tools: {
      execute: async (call) => {
        const result = call.tool === "update_tasks"
          ? { ok: true }
          : { error: "capability_unavailable_on_mobile", tool: call.tool };
        onEvent({ type: "tool.completed", callId: call.callId, result });
        return { callId: call.callId, result };
      },
    },
    transport: {
      recover: (runId, _workspaceInstructions, partialContent, partialReasoning, results) => postRun(runId, "recover", { partialContent, partialReasoning, results }),
      resume: (runId, results) => postRun(runId, "resume", { results }),
    },
    onEvent: (event) => {
      if (event.type === "run.failed") failedCode = event.errorCode;
      onEvent(event);
    },
  });
  if (failedCode) throw new ApiError(failedCode);
}
