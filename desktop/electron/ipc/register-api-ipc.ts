import { ipcMain } from "electron";
import { apiRequest, getApiStatus } from "../api/api-client.js";
import { getApiUrl, setApiUrl } from "../config.js";

export function registerApiIpc(): void {
  ipcMain.handle("api:status", getApiStatus);
  ipcMain.handle("debug:get-config", () => ({ apiUrl: getApiUrl() }));
  ipcMain.handle("debug:set-api-url", (_event, apiUrl: string) => ({ apiUrl: setApiUrl(apiUrl) }));
  ipcMain.handle("debug:context-snapshot", (_event, conversationId: string) => apiRequest(`/api/projects/conversations/${encodeURIComponent(conversationId)}/context-snapshot`));
}
