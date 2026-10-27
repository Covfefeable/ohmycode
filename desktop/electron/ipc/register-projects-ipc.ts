import { handleInvoke } from "./handle-invoke.js";
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
  handleInvoke("projects:list", listProjects);
  handleInvoke("projects:search-conversations", (_event, query: string) => searchConversations(query));
  handleInvoke("conversations:search-messages", (_event, conversationId: string, options: MessageSearchQuery) => searchMessages(conversationId, options));
  handleInvoke("projects:create", createProject);
  handleInvoke("projects:open", (_event, projectId: string) => openProject(projectId));
  handleInvoke("projects:delete", (_event, projectId: string) => deleteProject(projectId));
  handleInvoke("projects:create-conversation", (_event, projectId: string, title: string) => createConversation(projectId, title));
  handleInvoke("projects:delete-conversation", (_event, projectId: string, conversationId: string) => removeConversation(projectId, conversationId));
  handleInvoke("conversations:get", (_event, conversationId: string) => getConversation(conversationId));
  handleInvoke("conversations:history", (_event, conversationId: string, options?: ConversationHistoryQuery) => getConversationHistory(conversationId, options));
  handleInvoke("conversations:branch", (_event, conversationId: string, messageId: string) => branchConversation(conversationId, messageId));
  handleInvoke("conversations:suggest", (_event, conversationId: string) => suggestFollowups(conversationId));
  handleInvoke("conversations:start-turn", (_event, conversationId: string, content: string, modelId?: string, editMessageId?: string, attachments?: MessageAttachment[]) =>
    submitConversationMessage({ conversationId, content, modelId, editMessageId, attachments }));
  handleInvoke("conversations:followups", (_event, id: string) => followupSnapshot(id));
  handleInvoke("conversations:steer", (_event, id: string, inputId: string) => steerFollowup(id, inputId));
  handleInvoke("conversations:withdraw", (_event, id: string, inputId: string) => withdrawFollowup(id, inputId));
  handleInvoke("conversations:resume-queue", (_event, id: string) => resumeFollowups(id));
  handleInvoke("conversations:thread-snapshot", (_event, conversationId: string, afterSequence?: number) =>
    getThreadSnapshot(conversationId, afterSequence));
  handleInvoke("conversations:wait-turn", async (_event, turnId: string) => {
    const pending = waitForTurn(turnId);
    return pending ? pending : null;
  });
  handleInvoke("conversations:interrupt-turn", (_event, turnId: string, partialMessage) =>
    interruptTurn(turnId, partialMessage));
}
