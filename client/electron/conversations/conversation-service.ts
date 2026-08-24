import { apiFetch, apiRequest } from "../api/api-client.js";
import type { LocalConversation } from "../projects/types.js";

type ServerChunk = { content?: string };

async function forwardServerStream(response: Response, onChunk: (content: string) => void) {
  if (!response.body) throw new Error("missing_server_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      const content = (JSON.parse(data) as ServerChunk).content;
      if (content) onChunk(content);
    }
    if (done) break;
  }
}

export async function streamMessage(
  conversationId: string,
  content: string,
  modelId: string | undefined,
  editMessageId: string | undefined,
  onChunk: (content: string) => void,
): Promise<LocalConversation> {
  const response = await apiFetch(`/api/projects/conversations/${conversationId}/stream`, {
    method: "POST",
    body: JSON.stringify({ content, modelId, editMessageId }),
  });
  if (!response.ok) throw new Error(`server_stream_${response.status}`);
  await forwardServerStream(response, onChunk);
  return apiRequest(`/api/projects/conversations/${conversationId}`);
}
