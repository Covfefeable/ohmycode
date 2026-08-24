import { ipcMain } from "electron";
import {
  createMultiAgent,
  deleteMultiAgent,
  deleteMultiAgentTask,
  getMultiAgentTask,
  listMultiAgents,
  planMultiAgentTask,
  runMultiAgentTask,
  saveMultiAgentFlow,
  stopMultiAgentTask,
} from "../multi-agents/multi-agent-service.js";

export function registerMultiAgentIpc(): void {
  ipcMain.handle("multi-agents:list", listMultiAgents);
  ipcMain.handle("multi-agents:create", createMultiAgent);
  ipcMain.handle("multi-agents:delete", (_event, agentId: string) => deleteMultiAgent(agentId));
  ipcMain.handle("multi-agents:plan-task", (_event, agentId: string, request: string, modelId?: string) => planMultiAgentTask(agentId, request, modelId));
  ipcMain.handle("multi-agents:get-task", (_event, taskId: string) => getMultiAgentTask(taskId));
  ipcMain.handle("multi-agents:save-flow", (_event, taskId: string, positions) => saveMultiAgentFlow(taskId, positions));
  ipcMain.handle("multi-agents:delete-task", (_event, taskId: string) => deleteMultiAgentTask(taskId));
  ipcMain.handle("multi-agents:run-task", (event, taskId: string, requestId: string) =>
    runMultiAgentTask(taskId, requestId, (runEvent) => event.sender.send(`multi-agent:event:${requestId}`, runEvent)));
  ipcMain.handle("multi-agents:stop-task", (_event, requestId: string) => stopMultiAgentTask(requestId));
}
