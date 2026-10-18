export type LocalConversation = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages?: LocalMessage[];
  olderCursor?: string | null;
  newerCursor?: string | null;
  contextUsage?: { usedTokens: number; contextLength: number; source: "provider" } | null;
};
export type ConversationHistoryQuery = { before?: string; after?: string; around?: string; turnId?: string };
export type MessageSearchQuery = { query: string; at?: string; direction?: "next" | "previous" };
export type MessageSearchResult = { messageId: string | null; position: number; total: number };

export type ConversationSearchResult = {
  projectId: string;
  projectName: string;
  conversation: LocalConversation;
  snippet: string | null;
  messageId: string | null;
};

export type MessageAttachment = { id: string; name: string; path: string; size: number; mimeType: string };
export type LocalMessage = { id: string; role: "user" | "assistant"; content: string; attachments?: MessageAttachment[]; reasoning?: string | null; activity?: unknown[] | null; agentDurationMs?: number | null; createdAt: string };

export type LocalProject = {
  id: string;
  name: string;
  path: string;
  deviceId: string;
  deviceName: string;
  conversations: LocalConversation[];
};
