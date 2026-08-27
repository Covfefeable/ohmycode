import type { FileToolName, FileToolRequest } from "../files/types.js";
import type { TerminalAction } from "../terminal/types.js";
import type { ViewImageArguments } from "../files/image-tool.js";

export type AgentTask = { id: string; content: string; status: "pending" | "in_progress" | "completed" };
export type ToolRequestEvent = {
  type: "tool.requested";
  runId: string;
  callId: string;
  tool: "terminal" | "agent_message" | "finish_collaboration" | "view_image" | "search_capabilities" | "load_capability" | FileToolName | string;
  arguments: TerminalAction | FileToolRequest | ViewImageArguments | { toNodeId: string; content: string } | { content: string };
  taskId?: string;
};
export type ConversationStreamEvent = {
  type: "reasoning.delta" | "message.delta";
  content: string;
} | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "message.started" }
  | { type: "context.usage"; usedTokens: number; contextLength: number; source: "estimated" | "provider" }
  | { type: "context.compaction.started" | "context.compaction.completed"; estimatedTokens: number; contextLength: number }
  | { type: "task.plan.updated"; tasks: AgentTask[] }
  | ToolRequestEvent
  | { type: "tool.completed"; callId: string; result: unknown };

export async function forwardServerStream(
  response: Response,
  onEvent: (event: ConversationStreamEvent) => void,
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
    const event = JSON.parse(data) as ConversationStreamEvent;
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
