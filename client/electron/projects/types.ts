export type LocalConversation = {
  id: string;
  title: string;
  createdAt: string;
  messages?: LocalMessage[];
};

export type LocalMessage = { id: string; role: "user" | "assistant"; content: string; reasoning?: string | null; activity?: unknown[] | null; agentDurationMs?: number | null; createdAt: string };

export type LocalProject = {
  id: string;
  name: string;
  path: string;
  conversations: LocalConversation[];
};
