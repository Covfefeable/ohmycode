import type { AgentStreamEvent, ToolRequestEvent } from "./contracts.js";

export async function forwardServerStream(
  response: Response,
  onEvent: (event: AgentStreamEvent) => void,
  seenEvents: Set<string> = new Set(),
  onContinuation?: (executionId: string) => void,
): Promise<ToolRequestEvent[]> {
  if (!response.body) throw new Error("missing_server_stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const toolRequests: ToolRequestEvent[] = [];
  let eventId = "";
  const processLine = (line: string) => {
    if (line.startsWith("id:")) {
      eventId = line.slice(3).trim();
      return;
    }
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") {
      completed = true;
      return;
    }
    const event = JSON.parse(data) as AgentStreamEvent;
    if (event.type === "run.continue") onContinuation?.(event.executionId);
    if (event.type === "tool.requested") toolRequests.push(event);
    if (eventId && seenEvents.has(eventId)) return;
    onEvent(event);
    if (eventId) seenEvents.add(eventId);
  };
  try {
    while (!completed) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        processLine(line);
        if (completed) break;
      }
      if (done) break;
    }
    if (!completed && buffer) processLine(buffer);
    if (!completed) throw new Error("unexpected_stream_eof");
    return toolRequests;
  } finally {
    // Cancellation is cleanup: preserve the original stream/consumer error if it also fails.
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
