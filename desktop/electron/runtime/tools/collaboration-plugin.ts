import { defineToolPlugin } from "@ohmycode/agent-runtime";
import type { ToolCall, ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { apiRequest } from "../../api/api-client.js";
import type { DesktopExecutionContext } from "../types.js";

const AGENT_MESSAGE_DEFINITION: ToolDefinition = {
  name: "agent_message",
  description: "Post a group-chat message and hand the active turn to another collaboration member.",
  inputSchema: {
    type: "object", properties: { toNodeId: { type: "string" }, content: { type: "string" } },
    required: ["toNodeId", "content"],
  },
};

const FINISH_COLLABORATION_DEFINITION: ToolDefinition = {
  name: "finish_collaboration",
  description: "Host only: end the collaboration and publish the final answer.",
  inputSchema: {
    type: "object", properties: { content: { type: "string" } }, required: ["content"],
  },
};

export function createCollaborationPlugin(context: DesktopExecutionContext): ToolPlugin {
  const definitions = [
    AGENT_MESSAGE_DEFINITION,
    ...(context.isHost ? [FINISH_COLLABORATION_DEFINITION] : []),
  ];
  return defineToolPlugin({
    id: "collaboration",
    definitions,
    execute: (call: ToolCall) => apiRequest(
      `/api/multi-agents/nodes/${context.ownerId}/${call.tool === "agent_message" ? "messages" : "finish"}`,
      { method: "POST", body: JSON.stringify(call.arguments) },
    ),
  });
}
