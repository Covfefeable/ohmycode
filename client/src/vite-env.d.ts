/// <reference types="vite/client" />

interface Window {
  ohmycode: {
    projects: {
      list(): Promise<LocalProject[]>;
      create(): Promise<{ ok: true; project: LocalProject } | { ok: false; reason: "canceled" | "exists" }>;
      open(projectId: string): Promise<void>;
      delete(projectId: string): Promise<void>;
      createConversation(projectId: string, title: string): Promise<LocalConversation>;
      deleteConversation(projectId: string, conversationId: string): Promise<void>;
    };
    multiAgents: {
      list(): Promise<MultiAgentSummary[]>;
      create(payload: { name: string; description: string; division: string }): Promise<MultiAgentSummary>;
      update(agentId: string, payload: Partial<MultiAgentSummary>): Promise<MultiAgentSummary>;
      delete(agentId: string): Promise<void>;
      selectWorkspace(): Promise<string | null>;
      createTask(agentId: string, request: string, workspacePath: string): Promise<MultiAgentTask>;
      getTask(taskId: string): Promise<MultiAgentTask>;
      saveFlow(taskId: string, positions: Record<string, { x: number; y: number }>): Promise<MultiAgentTask>;
      deleteTask(taskId: string): Promise<void>;
      runTask(taskId: string, requestId: string): Promise<MultiAgentTask>;
      stopTask(requestId: string): Promise<void>;
      adjustNode(taskId: string, nodeId: string, content: string, requestId: string): Promise<MultiAgentTask>;
      onEvent(requestId: string, callback: (event: MultiAgentRunEvent) => void): () => void;
    };
    conversations: {
      get(conversationId: string): Promise<LocalConversation>;
      send(conversationId: string, content: string, modelId: string | undefined, requestId: string, editMessageId?: string): Promise<LocalConversation>;
      stop(requestId: string, partialMessage?: LocalMessage): Promise<void>;
      onEvent(requestId: string, callback: (event: ConversationStreamEvent) => void): () => void;
    };
    apiStatus(): Promise<{ online: boolean; url: string }>;
    auth: {
      bootstrap(): Promise<
        | { authenticated: false }
        | { authenticated: true; user: AuthUser }
      >;
      login(payload: LoginPayload): Promise<AuthResponse>;
      register(payload: RegistrationPayload): Promise<AuthResponse>;
      logout(): Promise<void>;
    };
    windowControls: {
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
    };
    settings: {
      get(): Promise<PublicSettings>;
      saveProfile(displayName: string): Promise<void>;
      saveModels(models: ModelConfiguration[]): Promise<void>;
      testModel(model: ModelConfiguration): Promise<{ ok: boolean; latencyMs?: number; message?: string }>;
    };
    terminal: {
      execute(action: TerminalAction): Promise<TerminalResult | TerminalResult[]>;
    };
  };
}

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

type LoginPayload = { email: string; password: string };
type RegistrationPayload = LoginPayload & { displayName: string };
type AuthResponse = {
  ok: boolean;
  status: number;
  payload: { user?: AuthUser; error?: { code: string; fields?: Record<string, string> } };
};

type ModelConfiguration = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  contextLength: number;
  apiKey?: string;
  hasApiKey?: boolean;
};
type PublicSettings = {
  profile: { displayName: string; avatarDataUrl: string | null };
  models: ModelConfiguration[];
  tokenUsage: TokenUsageEntry[];
};
type TokenUsageEntry = { date: string; tokens: number };
type MultiAgentTaskSummary = { id: string; title: string; status: string; createdAt: string };
type MultiAgentTemplateNode = { key: string; name: string; role: string; instructions: string; modelId?: string | null; position: { x: number; y: number } };
type MultiAgentTemplateFlow = { title: string; nodes: MultiAgentTemplateNode[]; edges: Array<{ source: string; target: string }> };
type MultiAgentSummary = { id: string; name: string; description: string; division: string; templateFlow: MultiAgentTemplateFlow; createdAt: string; tasks: MultiAgentTaskSummary[] };
type MultiAgentMessage = { id: string; fromNodeId: string | null; toNodeId: string; type: string; senderType: "user" | "agent"; content: string; expectsReply: boolean; replyToId?: string | null; createdAt: string };
type MultiAgentNodeData = { id: string; key: string; name: string; role: string; instructions: string; status: string; position: { x: number; y: number }; conversationId?: string | null; modelId?: string | null; finalOutput?: Record<string, unknown> | null; messages: MultiAgentMessage[]; changedFiles: Array<{ id: string; path: string; operation: string; sequence: number }> };
type MultiAgentTask = { id: string; agentId: string; title: string; request: string; status: string; workspacePath: string; nodes: MultiAgentNodeData[]; edges: Array<{ id: string; source: string; target: string }>; createdAt: string; updatedAt: string };
type ConversationStreamEvent =
  | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "message.started" }
  | { type: "message.delta"; content: string }
  | { type: "tool.requested"; runId: string; callId: string; tool: "terminal" | "agent_message"; arguments: TerminalAction | { toNodeId: string; content: string; expectsReply?: boolean } }
  | { type: "tool.completed"; callId: string; result: unknown };
type MultiAgentRunEvent =
  | { type: "task.updated"; task: MultiAgentTask }
  | { type: "node.event"; nodeId: string; event: ConversationStreamEvent }
  | { type: "task.failed"; error: string };
type AgentActivityStep =
  | { id: string; type: "reasoning"; content: string; status: "running" | "completed" }
  | { id: string; type: "message"; content: string; status: "running" | "completed" }
  | { id: string; type: "tool"; tool: string; input: string | TerminalAction; result?: unknown; status: "running" | "completed" };
type LocalMessage = { id: string; role: "user" | "assistant"; content: string; reasoning?: string | null; activity?: AgentActivityStep[] | null; agentDurationMs?: number | null; agentStartedAt?: string; createdAt: string };
type LocalConversation = { id: string; title: string; createdAt: string; messages?: LocalMessage[] };
type LocalProject = { id: string; name: string; path: string; conversations: LocalConversation[] };
type TerminalStatus = "running" | "exited" | "stopped";
type TerminalAction =
  | { action: "start"; projectId: string; command: string; cwd?: string; yieldMs?: number; intent?: "read" | "write" }
  | { action: "read"; terminalId: string; afterCursor?: number; yieldMs?: number }
  | { action: "write"; terminalId: string; input: string }
  | { action: "stop"; terminalId: string }
  | { action: "list"; projectId?: string };
type TerminalResult = { terminalId: string; command: string; cwd: string; status: TerminalStatus; cursor: number; output: string; truncated?: boolean; exitCode?: number };
