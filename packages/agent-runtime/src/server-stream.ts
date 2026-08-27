import type { AgentStreamEvent, ToolRequestEvent } from "./contracts.js";

export async function forwardServerStream(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
): Promise<ToolRequestEvent[]> {
  if (!response.body) throw new Error("missing_server_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const toolRequests: ToolRequestEvent[] = [];
  const processLine = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      completed = true;
      return;
    }
    const event = JSON.parse(data) as AgentStreamEvent;
    if (event.type === "tool.requested") toolRequests.push(event);
    onEvent(event);
  };
  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
    if (done) break;
  }
  if (buffer) processLine(buffer);
  if (!completed) throw new Error("unexpected_stream_eof");
  return toolRequests;
}
