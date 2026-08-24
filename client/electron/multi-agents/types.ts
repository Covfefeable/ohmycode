export type MultiAgentTaskSummary = {
  id: string;
  title: string;
  status: string;
  createdAt: string;
};

export type MultiAgentSummary = {
  id: string;
  name: string;
  description: string;
  division: string;
  templateFlow: {
    title: string;
    nodes: Array<{ key: string; name: string; role: string; instructions: string; modelId?: string | null; position: { x: number; y: number } }>;
    edges: Array<{ source: string; target: string }>;
  };
  createdAt: string;
  tasks: MultiAgentTaskSummary[];
};

export type MultiAgentMessage = {
  id: string;
  fromNodeId: string | null;
  toNodeId: string;
  type: string;
  senderType: "user" | "agent";
  content: string;
  expectsReply: boolean;
  replyToId?: string | null;
  createdAt: string;
};

export type MultiAgentNode = {
  id: string;
  key: string;
  name: string;
  role: string;
  instructions: string;
  status: string;
  position: { x: number; y: number };
  conversationId?: string | null;
  modelId?: string | null;
  finalOutput?: Record<string, unknown> | null;
  agentStartedAt?: string | null;
  agentDurationMs?: number | null;
  messages: MultiAgentMessage[];
  changedFiles: Array<{ id: string; path: string; operation: string; sequence: number }>;
};

export type MultiAgentTask = {
  id: string;
  agentId: string;
  title: string;
  request: string;
  status: string;
  workspacePath: string;
  nodes: MultiAgentNode[];
  edges: Array<{ id: string; source: string; target: string }>;
  createdAt: string;
  updatedAt: string;
};
