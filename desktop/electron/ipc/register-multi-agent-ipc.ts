import { handleInvoke } from "./handle-invoke.js";
import {
  createMultiAgent,
  deleteMultiAgent,
  deleteMultiAgentTask,
  getMultiAgentTask,
  getMultiAgentRunDetail,
  listMultiAgents,
  createMultiAgentTask,
  runMultiAgentTask,
  sendCollaborationMessage,
  selectMultiAgentWorkspace,
  stopMultiAgentTask,
  updateMultiAgent,
} from "../multi-agents/multi-agent-service.js";

export function registerMultiAgentIpc(): void {
  handleInvoke("multi-agents:list", listMultiAgents);
  handleInvoke("multi-agents:create", (_event, payload) => createMultiAgent(payload));
  handleInvoke("multi-agents:update", (_event, agentId: string, payload) => updateMultiAgent(agentId, payload));
  handleInvoke("multi-agents:delete", (_event, agentId: string) => deleteMultiAgent(agentId));
  handleInvoke("multi-agents:select-workspace", selectMultiAgentWorkspace);
  handleInvoke("multi-agents:create-task", (_event, agentId: string, request: string, workspacePath: string, executionLimit: number) => createMultiAgentTask(agentId, request, workspacePath, executionLimit));
  handleInvoke("multi-agents:get-task", (_event, taskId: string) => getMultiAgentTask(taskId));
  handleInvoke("multi-agents:get-run-detail", (_event, messageId: string) => getMultiAgentRunDetail(messageId));
  handleInvoke("multi-agents:delete-task", (_event, taskId: string) => deleteMultiAgentTask(taskId));
  handleInvoke("multi-agents:run-task", (event, taskId: string, requestId: string) =>
    runMultiAgentTask(taskId, requestId, (runEvent) => event.sender.send(`multi-agent:event:${requestId}`, runEvent)));
  handleInvoke("multi-agents:stop-task", (_event, requestId: string | null, taskId?: string) => stopMultiAgentTask(requestId, taskId));
  handleInvoke("multi-agents:send-message", (_event, taskId: string, nodeId: string, content: string) =>
    sendCollaborationMessage(taskId, nodeId, content));
}
