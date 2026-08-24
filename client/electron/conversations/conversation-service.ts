import { apiFetch, apiRequest } from "../api/api-client.js";
import type { LocalConversation } from "../projects/types.js";
import { executeTerminalAction } from "../terminal/terminal-manager.js";
import type { TerminalAction } from "../terminal/types.js";

export type ConversationStreamEvent = {
  type: "reasoning.delta" | "message.delta";
  content: string;
} | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "message.started" }
  | ToolRequestEvent
  | { type: "tool.completed"; callId: string; result: unknown };
type ToolRequestEvent = { type: "tool.requested"; runId: string; callId: string; tool: "terminal"; arguments: TerminalAction };
type ActiveRequest = { controller: AbortController; runId?: string; terminalIds: Set<string> };
const activeRequests = new Map<string, ActiveRequest>();

async function forwardServerStream(response: Response, onEvent: (event: ConversationStreamEvent) => void): Promise<ToolRequestEvent[]> {
  if (!response.body) throw new Error("missing_server_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const toolRequests: ToolRequestEvent[] = [];
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const event = JSON.parse(data) as ConversationStreamEvent | ToolRequestEvent;
      if (event.type === "run.failed") throw new Error(event.errorCode);
      if (event.type === "tool.requested") toolRequests.push(event);
      onEvent(event);
    }
    if (done) break;
  }
  return toolRequests;
}

export async function streamMessage(
  conversationId: string,
  content: string,
  modelId: string | undefined,
  editMessageId: string | undefined,
  requestId: string,
  onEvent: (event: ConversationStreamEvent) => void,
): Promise<LocalConversation> {
  const active: ActiveRequest = { controller: new AbortController(), terminalIds: new Set() };
  activeRequests.set(requestId, active);
  try {
    let response = await apiFetch(`/api/projects/conversations/${conversationId}/stream`, {
      method: "POST",
      body: JSON.stringify({ content, modelId, editMessageId }),
      signal: active.controller.signal,
    });
    if (!response.ok) throw new Error(`server_stream_${response.status}`);
    while (true) {
      const requests = await forwardServerStream(response, (event) => {
        if (event.type === "run.started") active.runId = event.runId;
        onEvent(event);
      });
      if (requests.length === 0 || active.controller.signal.aborted) break;
      const results = await Promise.all(requests.map(async (request) => {
        try {
          const result = await executeTerminalAction(request.arguments, active.controller.signal);
          const items = Array.isArray(result) ? result : [result];
          for (const item of items) if (item.terminalId) active.terminalIds.add(item.terminalId);
          onEvent({ type: "tool.completed", callId: request.callId, result });
          return { callId: request.callId, result };
        } catch (error) {
          const result = { error: error instanceof Error ? error.message : "terminal_failed" };
          onEvent({ type: "tool.completed", callId: request.callId, result });
          return { callId: request.callId, result };
        }
      }));
      if (active.controller.signal.aborted) break;
      response = await apiFetch(`/api/agent-runs/${requests[0].runId}/resume`, {
        method: "POST",
        body: JSON.stringify({ results }),
        signal: active.controller.signal,
      });
      if (!response.ok) throw new Error(`server_resume_${response.status}`);
    }
  } catch (error) {
    if (!active.controller.signal.aborted) throw error;
  } finally {
    activeRequests.delete(requestId);
  }
  return apiRequest(`/api/projects/conversations/${conversationId}`);
}

export async function stopMessage(requestId: string): Promise<void> {
  const active = activeRequests.get(requestId);
  if (!active) return;
  active.controller.abort();
  await Promise.allSettled([
    ...[...active.terminalIds].map((terminalId) => executeTerminalAction({ action: "stop", terminalId })),
    ...(active.runId ? [apiRequest(`/api/agent-runs/${active.runId}/cancel`, { method: "POST" })] : []),
  ]);
}
