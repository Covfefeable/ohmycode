import { ipcMain } from "electron";
import {
  createMultiAgent,
  deleteMultiAgent,
  deleteMultiAgentTask,
  getMultiAgentTask,
  listMultiAgents,
  createMultiAgentTask,
  runMultiAgentTask,
  sendCollaborationMessage,
  selectMultiAgentWorkspace,
  stopMultiAgentTask,
  updateMultiAgent,
} from "../multi-agents/multi-agent-service.js";

export function registerMultiAgentIpc(): void {
  ipcMain.handle("multi-agents:list", listMultiAgents);
  ipcMain.handle("multi-agents:create", (_event, payload) => createMultiAgent(payload));
  ipcMain.handle("multi-agents:update", (_event, agentId: string, payload) => updateMultiAgent(agentId, payload));
  ipcMain.handle("multi-agents:delete", (_event, agentId: string) => deleteMultiAgent(agentId));
  ipcMain.handle("multi-agents:select-workspace", selectMultiAgentWorkspace);
  ipcMain.handle("multi-agents:create-task", (_event, agentId: string, request: string, workspacePath: string, executionLimit: number) => createMultiAgentTask(agentId, request, workspacePath, executionLimit));
  ipcMain.handle("multi-agents:get-task", (_event, taskId: string) => getMultiAgentTask(taskId));
  ipcMain.handle("multi-agents:delete-task", (_event, taskId: string) => deleteMultiAgentTask(taskId));
  ipcMain.handle("multi-agents:run-task", (event, taskId: string, requestId: string) =>
    runMultiAgentTask(taskId, requestId, (runEvent) => event.sender.send(`multi-agent:event:${requestId}`, runEvent)));
  ipcMain.handle("multi-agents:stop-task", (_event, requestId: string | null, taskId?: string) => stopMultiAgentTask(requestId, taskId));
  ipcMain.handle("multi-agents:send-message", (_event, taskId: string, nodeId: string, content: string) =>
    sendCollaborationMessage(taskId, nodeId, content));
}
