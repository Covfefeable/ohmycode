import { apiErrorFromResponse, apiFetch, apiRequest } from "../api/api-client.js";
import type { LocalConversation, MessageAttachment } from "../projects/types.js";
import type { ToolResult } from "../runtime/tool-registry.js";

export type StartStreamInput = {
  conversationId: string;
  content: string;
  modelId?: string;
  editMessageId?: string;
  attachments?: MessageAttachment[];
  workspaceInstructions: string;
  turnId: string;
};

async function checked(response: Response): Promise<Response> {
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response;
}

export class ConversationTransport {
  constructor(private readonly signal: AbortSignal) {}

  start(input: StartStreamInput): Promise<Response> {
    return apiFetch(`/api/projects/conversations/${input.conversationId}/stream`, {
      method: "POST",
      body: JSON.stringify({
        content: input.content,
        modelId: input.modelId,
        editMessageId: input.editMessageId,
        attachments: input.attachments,
        workspaceInstructions: input.workspaceInstructions,
        turnId: input.turnId,
      }),
      signal: this.signal,
    }).then(checked);
  }

  resume(runId: string, results: ToolResult[], workspaceInstructions: string): Promise<Response> {
    return apiFetch(`/api/agent-runs/${runId}/resume`, {
      method: "POST",
      body: JSON.stringify({ results, workspaceInstructions }),
      signal: this.signal,
    }).then(checked);
  }

  recover(
    runId: string,
    workspaceInstructions: string,
    partialContent: string,
    partialReasoning: string,
    results: ToolResult[],
  ): Promise<Response> {
    return apiFetch(`/api/agent-runs/${runId}/recover`, {
      method: "POST",
      body: JSON.stringify({
        workspaceInstructions,
        partialContent,
        partialReasoning,
        results,
      }),
      signal: this.signal,
    }).then(checked);
  }

  conversation(conversationId: string): Promise<LocalConversation> {
    return apiRequest(`/api/projects/conversations/${conversationId}`);
  }
}
