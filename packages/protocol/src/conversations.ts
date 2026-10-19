import type { AgentTask, RuntimeEvent } from "./index.js";

export type AgentActivityStep =
  | { id: string; type: "run"; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "context"; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "task_plan"; tasks: AgentTask[] }
  | { id: string; type: "reasoning"; content: string; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "message"; content: string; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "tool"; tool: string; input: unknown; result?: unknown; status: "running" | "completed"; taskId?: string };
export type MessageAttachment = { id: string; name: string; path: string; size: number; mimeType: string };
export type LocalMessage = {
  id: string; role: "user" | "assistant"; content: string; attachments?: MessageAttachment[];
  reasoning?: string | null; activity?: AgentActivityStep[] | null; agentDurationMs?: number | null;
  agentStartedAt?: string; createdAt: string;
};
export type LocalConversation = {
  id: string; title: string; createdAt: string; updatedAt: string; messages?: LocalMessage[];
  olderCursor?: string | null; newerCursor?: string | null;
  contextUsage?: { usedTokens: number; contextLength: number; source: "provider" } | null;
};
export type LocalProject = {
  id: string; name: string; path: string; deviceId: string; deviceName: string;
  conversations: LocalConversation[];
};
export type ConversationHistoryQuery = { before?: string; after?: string; around?: string; turnId?: string };
export type MessageSearchQuery = { query: string; at?: string; direction?: "next" | "previous" };
export type MessageSearchResult = { messageId: string | null; position: number; total: number };
export type ConversationSearchResult = {
  projectId: string; projectName: string; conversation: LocalConversation;
  snippet: string | null; messageId: string | null;
};
export type MultiAgentTaskSummary = { id: string; title: string; status: string; createdAt: string };
export type MultiAgentTemplateMember = {
  key: string; name: string; role: string; instructions: string;
  modelId?: string | null; isHost: boolean; sortOrder: number;
};
export type MultiAgentTemplateTeam = { title: string; members: MultiAgentTemplateMember[] };
export type MultiAgentSummary = {
  id: string; name: string; description: string; division: string;
  templateTeam: MultiAgentTemplateTeam; createdAt: string; tasks: MultiAgentTaskSummary[];
};
export type MultiAgentMessage = {
  id: string; fromNodeId: string | null; toNodeId: string | null; runId: string | null;
  type: string; senderType: "user" | "agent"; content: string; createdAt: string;
};
export type MultiAgentRunDetail = {
  id: string; status: string; errorCode?: string | null; startedAt: string;
  completedAt?: string | null; durationMs?: number | null;
  inputTokens?: number | null; outputTokens?: number | null; activity: AgentActivityStep[];
};
export type MultiAgentMemberData = MultiAgentTemplateMember & {
  id: string; status: string; conversationId?: string | null;
  finalOutput?: Record<string, unknown> | null; agentStartedAt?: string | null;
  agentDurationMs?: number | null;
  changedFiles: Array<{ id: string; path: string; operation: string; sequence: number }>;
};
export type MultiAgentTask = {
  id: string; agentId: string; title: string; request: string; status: string;
  workspacePath: string; executionLimit: number; executionCount: number;
  members: MultiAgentMemberData[]; messages: MultiAgentMessage[];
  currentSpeakerId?: string | null; createdAt: string; updatedAt: string;
};
export type MultiAgentRunEvent =
  | { type: "task.updated"; task: MultiAgentTask }
  | { type: "node.event"; nodeId: string; event: RuntimeEvent }
  | { type: "task.failed"; error: string };
