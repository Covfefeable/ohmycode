import { activeBrowser } from "../browser/browser-service.js";
import { deleteConversation } from "../projects/projects-service.js";
import type { MessageAttachment } from "../projects/types.js";
import { activeThreadTurn, startTurn } from "../runtime/desktop-runtime-host.js";
import { enqueueFollowup, followupSnapshot } from "../runtime/followup-host.js";

export async function submitConversationMessage(input: {
  conversationId: string;
  content: string;
  modelId?: string;
  editMessageId?: string;
  attachments?: MessageAttachment[];
}) {
  const { conversationId, content, modelId, editMessageId, attachments = [] } = input;
  const state = await followupSnapshot(conversationId);
  if (!editMessageId && (activeThreadTurn(conversationId) || state.inputs.length)) {
    await enqueueFollowup(conversationId, { id: crypto.randomUUID(), content, modelId, attachments, status: "queued" });
    return { queued: true as const };
  }
  return startTurn({ threadId: conversationId, content, modelId, editMessageId, attachments });
}

export async function removeConversation(projectId: string, conversationId: string): Promise<void> {
  await deleteConversation(projectId, conversationId);
  activeBrowser().closeSession(conversationId);
}
