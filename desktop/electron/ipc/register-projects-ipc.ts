import { ipcMain } from "electron";
import {
  branchConversation,
  createConversation,
  createProject,
  deleteProject,
  listProjects,
  openProject,
  getConversation,
  getConversationHistory,
  searchConversations,
  searchMessages,
  suggestFollowups,
} from "../projects/projects-service.js";
import { getThreadSnapshot, interruptTurn, waitForTurn } from "../runtime/desktop-runtime-host.js";
import { followupSnapshot, resumeFollowups, steerFollowup, withdrawFollowup } from "../runtime/followup-host.js";
import type { ConversationHistoryQuery, MessageAttachment, MessageSearchQuery } from "../projects/types.js";
import { removeConversation, submitConversationMessage } from "../conversations/conversation-actions.js";

export function registerProjectsIpc(): void {
  ipcMain.handle("projects:list", listProjects);
  ipcMain.handle("projects:search-conversations", (_event, query: string) => searchConversations(query));
  ipcMain.handle("conversations:search-messages", (_event, conversationId: string, options: MessageSearchQuery) => searchMessages(conversationId, options));
  ipcMain.handle("projects:create", createProject);
  ipcMain.handle("projects:open", (_event, projectId: string) => openProject(projectId));
  ipcMain.handle("projects:delete", (_event, projectId: string) => deleteProject(projectId));
  ipcMain.handle("projects:create-conversation", (_event, projectId: string, title: string) => createConversation(projectId, title));
  ipcMain.handle("projects:delete-conversation", (_event, projectId: string, conversationId: string) => removeConversation(projectId, conversationId));
  ipcMain.handle("conversations:get", (_event, conversationId: string) => getConversation(conversationId));
  ipcMain.handle("conversations:history", (_event, conversationId: string, options?: ConversationHistoryQuery) => getConversationHistory(conversationId, options));
  ipcMain.handle("conversations:branch", (_event, conversationId: string, messageId: string) => branchConversation(conversationId, messageId));
  ipcMain.handle("conversations:suggest", (_event, conversationId: string) => suggestFollowups(conversationId));
  ipcMain.handle("conversations:start-turn", (_event, conversationId: string, content: string, modelId?: string, editMessageId?: string, attachments?: MessageAttachment[]) =>
    submitConversationMessage({ conversationId, content, modelId, editMessageId, attachments }));
  ipcMain.handle("conversations:followups", (_event, id: string) => followupSnapshot(id));
  ipcMain.handle("conversations:steer", (_event, id: string, inputId: string) => steerFollowup(id, inputId));
  ipcMain.handle("conversations:withdraw", (_event, id: string, inputId: string) => withdrawFollowup(id, inputId));
  ipcMain.handle("conversations:resume-queue", (_event, id: string) => resumeFollowups(id));
  ipcMain.handle("conversations:thread-snapshot", (_event, conversationId: string, afterSequence?: number) =>
    getThreadSnapshot(conversationId, afterSequence));
  ipcMain.handle("conversations:wait-turn", async (_event, turnId: string) => {
    const pending = waitForTurn(turnId);
    return pending ? pending : null;
  });
  ipcMain.handle("conversations:interrupt-turn", (_event, turnId: string, partialMessage) =>
    interruptTurn(turnId, partialMessage));
}
