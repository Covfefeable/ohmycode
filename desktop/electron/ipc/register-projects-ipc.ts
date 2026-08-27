import { ipcMain } from "electron";
import {
  createConversation,
  createProject,
  deleteConversation,
  deleteProject,
  listProjects,
  openProject,
  getConversation,
  suggestFollowups,
} from "../projects/projects-service.js";
import { getThreadSnapshot, interruptTurn, startTurn, waitForTurn } from "../runtime/desktop-runtime-host.js";
import type { MessageAttachment } from "../projects/types.js";

export function registerProjectsIpc(): void {
  ipcMain.handle("projects:list", listProjects);
  ipcMain.handle("projects:create", createProject);
  ipcMain.handle("projects:open", (_event, projectId: string) => openProject(projectId));
  ipcMain.handle("projects:delete", (_event, projectId: string) => deleteProject(projectId));
  ipcMain.handle("projects:create-conversation", (_event, projectId: string, title: string) => createConversation(projectId, title));
  ipcMain.handle("projects:delete-conversation", (_event, projectId: string, conversationId: string) => deleteConversation(projectId, conversationId));
  ipcMain.handle("conversations:get", (_event, conversationId: string) => getConversation(conversationId));
  ipcMain.handle("conversations:suggest", (_event, conversationId: string) => suggestFollowups(conversationId));
  ipcMain.handle("conversations:start-turn", (_event, conversationId: string, content: string, modelId?: string, editMessageId?: string, attachments?: MessageAttachment[]) =>
    startTurn({ threadId: conversationId, content, modelId, editMessageId, attachments }));
  ipcMain.handle("conversations:thread-snapshot", (_event, conversationId: string, afterSequence?: number) =>
    getThreadSnapshot(conversationId, afterSequence));
  ipcMain.handle("conversations:wait-turn", async (_event, turnId: string) => {
    const pending = waitForTurn(turnId);
    return pending ? pending : null;
  });
  ipcMain.handle("conversations:interrupt-turn", (_event, turnId: string, partialMessage) =>
    interruptTurn(turnId, partialMessage));
}
