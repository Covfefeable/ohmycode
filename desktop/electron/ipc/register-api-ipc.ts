import { handleInvoke } from "./handle-invoke.js";
import { apiRequest, getApiStatus } from "../api/api-client.js";
import { getApiUrl, setApiUrl } from "../config.js";

export function registerApiIpc(): void {
  handleInvoke("api:status", getApiStatus);
  handleInvoke("debug:get-config", () => ({ apiUrl: getApiUrl() }));
  handleInvoke("debug:set-api-url", (_event, apiUrl: string) => ({ apiUrl: setApiUrl(apiUrl) }));
  handleInvoke("debug:context-snapshot", (_event, conversationId: string) => apiRequest(`/api/projects/conversations/${encodeURIComponent(conversationId)}/context-snapshot`));
}
