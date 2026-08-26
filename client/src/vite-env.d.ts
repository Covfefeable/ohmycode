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
      deleteTask(taskId: string): Promise<void>;
      runTask(taskId: string, requestId: string): Promise<MultiAgentTask>;
      stopTask(requestId: string | null, taskId?: string): Promise<void>;
      sendMessage(taskId: string, nodeId: string, content: string): Promise<MultiAgentTask>;
      onEvent(requestId: string, callback: (event: MultiAgentRunEvent) => void): () => void;
    };
    conversations: {
      get(conversationId: string): Promise<LocalConversation>;
      startTurn(conversationId: string, content: string, modelId?: string, editMessageId?: string, attachments?: MessageAttachment[]): Promise<{ turnId: string }>;
      resolveDroppedFiles(files: File[]): MessageAttachment[];
      threadSnapshot(conversationId: string, afterSequence?: number): Promise<TurnSnapshot | null>;
      waitTurn(turnId: string): Promise<LocalConversation | null>;
      interruptTurn(turnId: string, partialMessage?: LocalMessage): Promise<void>;
      onThreadEvent(conversationId: string, callback: (event: RuntimeEvent) => void): () => void;
    };
    apiStatus(): Promise<{ online: boolean; url: string }>;
    debug: {
      getConfig(): Promise<{ apiUrl: string }>;
      setApiUrl(apiUrl: string): Promise<{ apiUrl: string }>;
      openDevTools(): void;
    };
    openPath(targetPath: string, projectId?: string): Promise<void>;
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
      saveAvatar(data: string, contentType: string): Promise<void>;
      saveModels(models: ModelConfiguration[]): Promise<void>;
      testModel(model: ModelConfiguration): Promise<{ ok: boolean; latencyMs?: number; message?: string }>;
    };
    capabilities: {
      listMcp(): Promise<McpServerRecord[]>;
      saveMcp(input: McpServerInput): Promise<McpServerRecord>;
      testMcp(id: string): Promise<McpServerRecord>;
      deleteMcp(id: string): Promise<void>;
      listSkills(): Promise<SkillRecord[]>;
      installSkill(): Promise<SkillRecord | null>;
      downloadSkill(id: string): Promise<SkillRecord>;
      removeLocalSkill(name: string): Promise<void>;
      deleteSkill(id: string, name: string): Promise<void>;
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
  supportsVision: boolean;
  apiKey?: string;
  hasApiKey?: boolean;
};
type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
type McpServerInput = { id?: string; name: string; identifier: string; transport: "http" | "stdio"; configuration: { url?: string; headers?: Record<string, string>; command?: string; args?: string[]; cwd?: string; env?: Record<string, string> }; enabled: boolean };
type McpServerRecord = McpServerInput & { id: string; tools: McpTool[]; status: string; lastError?: string | null };
type SkillRecord = { id: string; name: string; description: string; version: string; sha256: string; size: number; enabled: boolean; installed: boolean };
type PublicSettings = {
  profile: { displayName: string; avatarAvailable: boolean; avatarDataUrl?: string | null };
  models: ModelConfiguration[];
  tokenUsage: TokenUsageEntry[];
};
type TokenUsageEntry = { date: string; tokens: number };
type MultiAgentTaskSummary = { id: string; title: string; status: string; createdAt: string };
type MultiAgentTemplateMember = { key: string; name: string; role: string; instructions: string; modelId?: string | null; isHost: boolean; sortOrder: number };
type MultiAgentTemplateTeam = { title: string; members: MultiAgentTemplateMember[] };
type MultiAgentSummary = { id: string; name: string; description: string; division: string; templateTeam: MultiAgentTemplateTeam; createdAt: string; tasks: MultiAgentTaskSummary[] };
type MultiAgentMessage = { id: string; fromNodeId: string | null; toNodeId: string; type: string; senderType: "user" | "agent"; content: string; createdAt: string };
type MultiAgentMemberData = MultiAgentTemplateMember & { id: string; status: string; conversationId?: string | null; finalOutput?: Record<string, unknown> | null; agentStartedAt?: string | null; agentDurationMs?: number | null; changedFiles: Array<{ id: string; path: string; operation: string; sequence: number }> };
type MultiAgentTask = { id: string; agentId: string; title: string; request: string; status: string; workspacePath: string; members: MultiAgentMemberData[]; messages: MultiAgentMessage[]; currentSpeakerId?: string | null; createdAt: string; updatedAt: string };
type ConversationStreamEvent =
  | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "message.started" }
  | { type: "message.delta"; content: string }
  | { type: "context.usage"; usedTokens: number; contextLength: number; source: "estimated" | "provider" }
  | { type: "context.compaction.started" | "context.compaction.completed"; estimatedTokens: number; contextLength: number }
  | { type: "tool.requested"; runId: string; callId: string; tool: "terminal" | "agent_message" | "finish_collaboration" | "view_image" | "read_file" | "search_files" | "list_directory" | "apply_patch"; arguments: TerminalAction | { imageUrl: string; detail?: "low" | "high" } | Record<string, unknown> }
  | { type: "tool.completed"; callId: string; result: unknown };
type RuntimeItem = { id: string; threadId: string; turnId: string; kind: "reasoning" | "agent_message" | "tool" | "context"; status: "in_progress" | "completed" | "failed" | "interrupted"; content?: string; tool?: string; input?: unknown; output?: unknown; errorCode?: string };
type RuntimeEvent =
  | { sequence: number; type: "turn.started"; threadId: string; turnId: string }
  | { sequence: number; type: "item.started"; threadId: string; turnId: string; item: RuntimeItem }
  | { sequence: number; type: "item.delta"; threadId: string; turnId: string; itemId: string; delta: string }
  | { sequence: number; type: "item.completed"; threadId: string; turnId: string; item: RuntimeItem }
  | { sequence: number; type: "context.updated"; threadId: string; turnId: string; usedTokens: number; contextLength: number; source: "estimated" | "provider" }
  | { sequence: number; type: "turn.completed"; threadId: string; turnId: string }
  | { sequence: number; type: "turn.failed"; threadId: string; turnId: string; errorCode: string }
  | { sequence: number; type: "turn.interrupted"; threadId: string; turnId: string };
type TurnSnapshot = { threadId: string; turnId: string; status: "in_progress" | "completed" | "failed" | "interrupted"; lastSequence: number; events: RuntimeEvent[] };
type MultiAgentRunEvent =
  | { type: "task.updated"; task: MultiAgentTask }
  | { type: "node.event"; nodeId: string; event: RuntimeEvent }
  | { type: "task.failed"; error: string };
type AgentActivityStep =
  | { id: string; type: "run"; status: "running" | "completed" }
  | { id: string; type: "reasoning"; content: string; status: "running" | "completed" }
  | { id: string; type: "message"; content: string; status: "running" | "completed" }
  | { id: string; type: "context"; status: "running" | "completed" }
  | { id: string; type: "tool"; tool: string; input: string | TerminalAction; result?: unknown; status: "running" | "completed" };
type MessageAttachment = { id: string; name: string; path: string; size: number; mimeType: string };
type LocalMessage = { id: string; role: "user" | "assistant"; content: string; attachments?: MessageAttachment[]; reasoning?: string | null; activity?: AgentActivityStep[] | null; agentDurationMs?: number | null; agentStartedAt?: string; createdAt: string };
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
