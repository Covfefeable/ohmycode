import { defineToolPlugin } from "@ohmycode/agent-runtime";
import type { ToolCall, ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { apiRequest } from "../../api/api-client.js";
import type { DesktopExecutionContext } from "../types.js";

const AGENT_MESSAGE_DEFINITION: ToolDefinition = {
  name: "agent_message",
  description: "Post a group-chat message to another member or the user, handing over or pausing the collaboration.",
  inputSchema: {
    type: "object", properties: { to: { type: "string", description: "A member UUID, or 'user'." }, content: { type: "string" } },
    required: ["to", "content"],
  },
};

export function createCollaborationPlugin(context: DesktopExecutionContext): ToolPlugin {
  return defineToolPlugin({
    id: "collaboration",
    definitions: [AGENT_MESSAGE_DEFINITION],
    execute: async (call: ToolCall) => {
      const result = await apiRequest<{ id: string; sourceStatus: string; targetStatus?: string; taskStatus: string }>(
        `/api/multi-agents/nodes/${context.ownerId}/messages`,
        { method: "POST", body: JSON.stringify(call.arguments) },
      );
      return { messageId: result.id, handedOff: result.sourceStatus === "idle" };
    },
  });
}
