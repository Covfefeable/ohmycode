import { ipcMain } from "electron";
import {
  createConversation,
  createProject,
  deleteConversation,
  deleteProject,
  listProjects,
  openProject,
  getConversation,
} from "../projects/projects-service.js";
import { stopMessage, streamMessage } from "../conversations/conversation-service.js";

export function registerProjectsIpc(): void {
  ipcMain.handle("projects:list", listProjects);
  ipcMain.handle("projects:create", createProject);
  ipcMain.handle("projects:open", (_event, projectId: string) => openProject(projectId));
  ipcMain.handle("projects:delete", (_event, projectId: string) => deleteProject(projectId));
  ipcMain.handle("projects:create-conversation", (_event, projectId: string, title: string) => createConversation(projectId, title));
  ipcMain.handle("projects:delete-conversation", (_event, projectId: string, conversationId: string) => deleteConversation(projectId, conversationId));
  ipcMain.handle("conversations:get", (_event, conversationId: string) => getConversation(conversationId));
  ipcMain.handle("conversations:send", (event, conversationId: string, content: string, modelId: string | undefined, requestId: string, editMessageId?: string) =>
    streamMessage(conversationId, content, modelId, editMessageId, requestId, (streamEvent) => event.sender.send(`conversation:event:${requestId}`, streamEvent)));
  ipcMain.handle("conversations:stop", (_event, requestId: string, partialMessage) => stopMessage(requestId, partialMessage));
}
