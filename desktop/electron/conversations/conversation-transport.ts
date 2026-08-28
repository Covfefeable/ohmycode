import { apiErrorFromResponse, apiFetch, apiRequest } from "../api/api-client.js";
import type { LocalConversation, MessageAttachment } from "../projects/types.js";
import type { AgentTransport } from "@ohmycode/agent-runtime";
import type { ProviderToolDefinition, ToolResult } from "@ohmycode/tool-contracts";

export type StartStreamInput = {
  conversationId: string;
  content: string;
  modelId?: string;
  editMessageId?: string;
  attachments?: MessageAttachment[];
  workspaceInstructions: string;
  turnId: string;
  tools: ProviderToolDefinition[];
};

async function checked(response: Response): Promise<Response> {
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response;
}

export class ConversationTransport implements AgentTransport {
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
        tools: input.tools,
      }),
      signal: this.signal,
    }).then(checked);
  }

  resume(runId: string, results: ToolResult[], workspaceInstructions: string, tools: ProviderToolDefinition[]): Promise<Response> {
    return apiFetch(`/api/agent-runs/${runId}/resume`, {
      method: "POST",
      body: JSON.stringify({ results, workspaceInstructions, tools }),
      signal: this.signal,
    }).then(checked);
  }

  recover(
    runId: string,
    workspaceInstructions: string,
    partialContent: string,
    partialReasoning: string,
    results: ToolResult[],
    tools: ProviderToolDefinition[],
  ): Promise<Response> {
    return apiFetch(`/api/agent-runs/${runId}/recover`, {
      method: "POST",
      body: JSON.stringify({
        workspaceInstructions,
        partialContent,
        partialReasoning,
        results,
        tools,
      }),
      signal: this.signal,
    }).then(checked);
  }

  conversation(conversationId: string): Promise<LocalConversation> {
    return apiRequest(`/api/projects/conversations/${conversationId}`);
  }
}
