import { forwardServerStream, type AgentStreamEvent } from "@ohmycode/agent-runtime";

import { authenticatedFetch, authenticatedRequest } from "@/shared/api/api-client";

export type MobileMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
};

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
  const response = await authenticatedFetch(`/api/mobile/conversations/${id}/stream`, {
    method: "POST",
    body: JSON.stringify({ content, turnId: turnId() }),
    signal,
  });
  await forwardServerStream(response, onEvent);
}
