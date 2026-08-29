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
      createTask(agentId: string, request: string, workspacePath: string, executionLimit: number): Promise<MultiAgentTask>;
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
      suggest(conversationId: string): Promise<string[]>;
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
      saveProfile(displayName: string): Promise<PublicSettings["profile"]>;
      saveAvatar(data: string, contentType: string): Promise<PublicSettings["profile"]>;
      onProfileChanged(callback: (profile: PublicSettings["profile"]) => void): () => void;
      saveModels(models: ModelConfiguration[]): Promise<ModelConfiguration[]>;
      saveBackgroundTasks(settings: BackgroundTaskSettings): Promise<BackgroundTaskSettings>;
      onModelsChanged(callback: (models: ModelConfiguration[]) => void): () => void;
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
      onChanged(callback: () => void): () => void;
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
  backgroundTasks: BackgroundTaskSettings;
  tokenUsage: TokenUsageEntry[];
};
type TokenUsageEntry = { date: string; tokens: number };
type BackgroundTaskSettings = { autoSummaryEnabled: boolean; autoSummaryModelId: string | null; contextCompactionThreshold: number; contextCompactionModelId: string | null; suggestionsEnabled: boolean; suggestionsModelId: string | null };
type MultiAgentTaskSummary = { id: string; title: string; status: string; createdAt: string };
type MultiAgentTemplateMember = { key: string; name: string; role: string; instructions: string; modelId?: string | null; isHost: boolean; sortOrder: number };
type MultiAgentTemplateTeam = { title: string; members: MultiAgentTemplateMember[] };
type MultiAgentSummary = { id: string; name: string; description: string; division: string; templateTeam: MultiAgentTemplateTeam; createdAt: string; tasks: MultiAgentTaskSummary[] };
type MultiAgentMessage = { id: string; fromNodeId: string | null; toNodeId: string; type: string; senderType: "user" | "agent"; content: string; createdAt: string };
type MultiAgentMemberData = MultiAgentTemplateMember & { id: string; status: string; conversationId?: string | null; finalOutput?: Record<string, unknown> | null; agentStartedAt?: string | null; agentDurationMs?: number | null; changedFiles: Array<{ id: string; path: string; operation: string; sequence: number }> };
type MultiAgentTask = { id: string; agentId: string; title: string; request: string; status: string; workspacePath: string; executionLimit: number; executionCount: number; members: MultiAgentMemberData[]; messages: MultiAgentMessage[]; currentSpeakerId?: string | null; createdAt: string; updatedAt: string };
type ConversationStreamEvent =
  | { type: "reasoning.started"; stepId: string }
  | { type: "run.started"; runId: string }
  | { type: "run.failed"; errorCode: string }
  | { type: "reasoning.delta"; content: string }
  | { type: "message.started" }
  | { type: "message.delta"; content: string }
  | { type: "context.usage"; usedTokens: number; contextLength: number; source: "estimated" | "provider" }
  | { type: "context.compaction.started" | "context.compaction.completed"; estimatedTokens: number; contextLength: number }
  | { type: "task.plan.updated"; tasks: AgentTask[] }
  | { type: "tool.requested"; runId: string; callId: string; tool: string; arguments: TerminalAction | Record<string, unknown>; taskId?: string }
  | { type: "tool.completed"; callId: string; result: unknown };
type AgentTask = import("@ohmycode/protocol").AgentTask;
type RuntimeItem = import("@ohmycode/protocol").RuntimeItem;
type RuntimeEvent = import("@ohmycode/protocol").RuntimeEvent;
type TurnSnapshot = import("@ohmycode/protocol").TurnSnapshot;
type MultiAgentRunEvent =
  | { type: "task.updated"; task: MultiAgentTask }
  | { type: "node.event"; nodeId: string; event: RuntimeEvent }
  | { type: "task.failed"; error: string };
type AgentActivityStep =
  | { id: string; type: "run"; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "task_plan"; tasks: AgentTask[] }
  | { id: string; type: "reasoning"; content: string; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "message"; content: string; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "context"; status: "running" | "completed"; taskId?: string }
  | { id: string; type: "tool"; tool: string; input: unknown; result?: unknown; status: "running" | "completed"; taskId?: string };
type MessageAttachment = { id: string; name: string; path: string; size: number; mimeType: string };
type LocalMessage = { id: string; role: "user" | "assistant"; content: string; attachments?: MessageAttachment[]; reasoning?: string | null; activity?: AgentActivityStep[] | null; agentDurationMs?: number | null; agentStartedAt?: string; createdAt: string };
type LocalConversation = { id: string; title: string; createdAt: string; messages?: LocalMessage[]; contextUsage?: { usedTokens: number; contextLength: number; source: "provider" } | null };
type LocalProject = { id: string; name: string; path: string; deviceId: string; deviceName: string; conversations: LocalConversation[] };
type TerminalStatus = "running" | "exited" | "stopped";
type TerminalAction =
  | { action: "start"; projectId: string; command: string; cwd?: string; yieldMs?: number; intent?: "read" | "write" }
  | { action: "read"; terminalId: string; afterCursor?: number; yieldMs?: number }
  | { action: "write"; terminalId: string; input: string }
  | { action: "stop"; terminalId: string }
  | { action: "list"; projectId?: string };
type TerminalResult = { terminalId: string; command: string; cwd: string; status: TerminalStatus; cursor: number; output: string; truncated?: boolean; exitCode?: number };
