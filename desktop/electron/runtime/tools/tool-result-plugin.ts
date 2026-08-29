import { ToolResultReaderPlugin } from "@ohmycode/agent-runtime";
import type { ToolPlugin } from "@ohmycode/tool-contracts";
import { apiRequest } from "../../api/api-client.js";

export function createToolResultPlugin(): ToolPlugin {
  return new ToolResultReaderPlugin({
    read: (runId, callId, options) => apiRequest(
      `/api/agent-runs/${runId}/tool-results/${encodeURIComponent(callId)}/read`,
      { method: "POST", body: JSON.stringify(options) },
    ),
    search: (runId, callId, query, options) => apiRequest(
      `/api/agent-runs/${runId}/tool-results/${encodeURIComponent(callId)}/search`,
      { method: "POST", body: JSON.stringify({ query, ...options }) },
    ),
  });
}
