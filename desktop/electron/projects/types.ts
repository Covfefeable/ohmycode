export type LocalConversation = {
  id: string;
  title: string;
  createdAt: string;
  messages?: LocalMessage[];
  contextUsage?: { usedTokens: number; contextLength: number; source: "provider" } | null;
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
