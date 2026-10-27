export type SpeechSettings = {
  workspaceId: string;
  voice: string;
  autoPlay: boolean;
  hasApiKey: boolean;
};
export type SpeechSettingsInput = Pick<
  SpeechSettings,
  "workspaceId" | "voice"
> & { apiKey?: string };
export type SpeechMode = "asr" | "tts";
export type CustomVoice = {
  id: string;
  voiceId: string;
  name: string;
  status: "DEPLOYING" | "OK" | "UNDEPLOYED";
};
export type VoiceCloneInput = {
  name: string;
  audioData: string;
  language: string;
  preprocess: boolean;
  consent: boolean;
};
export type SpeechEvent =
  | { type: "audio"; data: Uint8Array }
  | { type: "transcript"; sentenceId: number; text: string; final: boolean }
  | { type: "finished" }
  | { type: "error"; code: string };

export type ModelInput = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  hasApiKey?: boolean;
  contextLength: number;
  supportsVision: boolean;
};

export type BackgroundTaskSettings = {
  autoSummaryEnabled: boolean;
  autoSummaryModelId: string | null;
  contextCompactionThreshold: number;
  contextCompactionModelId: string | null;
  suggestionsEnabled: boolean;
  suggestionsModelId: string | null;
};

export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export type McpServerInput = {
  id?: string;
  name: string;
  identifier: string;
  transport: "http" | "stdio";
  configuration: {
    url?: string;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  enabled: boolean;
};
export type McpServerRecord = McpServerInput & { id: string; tools: McpTool[]; status: string; lastError?: string | null };
export type SkillRecord = { id: string; name: string; description: string; version: string; sha256: string; size: number; enabled: boolean; installed: boolean };

export type TerminalStatus = "running" | "exited" | "stopped";

export type TerminalResult = {
  terminalId: string;
  command: string;
  cwd: string;
  status: TerminalStatus;
  cursor: number;
  output: string;
  truncated?: boolean;
  exitCode?: number;
};

export type TerminalAction =
  | { action: "start"; projectId: string; command: string; cwd?: string; yieldMs?: number; intent?: "read" | "write" }
  | { action: "read"; terminalId: string; afterCursor?: number; yieldMs?: number }
  | { action: "write"; terminalId: string; input: string }
  | { action: "stop"; terminalId: string }
  | { action: "list"; projectId?: string };

export type ContextSnapshot = {
  conversationId: string;
  title: string;
  snapshot: null | {
    capturedAt: string;
    runId: string;
    executionId: string;
    step: number;
    status: string;
    body: { model: string; messages: unknown[]; tools?: unknown[]; [key: string]: unknown };
    estimatedTokens: number;
    contextLength: number;
    compacted: boolean;
    messageCount: number;
    toolCount: number;
    requestBytes: number;
    usage: null | {
      prompt_tokens?: number;
      input_tokens?: number;
      completion_tokens?: number;
      output_tokens?: number;
      prompt_cache_hit_tokens?: number;
      prompt_cache_miss_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
};


export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

export type LoginPayload = { email: string; password: string };
export type RegistrationPayload = LoginPayload & { displayName: string };
export type AuthResponse = {
  ok: boolean;
  status: number;
  payload: { user?: AuthUser; error?: { code: string; fields?: Record<string, string> } };
};
export type AuthBootstrap = { authenticated: false } | { authenticated: true; user: AuthUser };

export type ModelConfiguration = ModelInput;
export type PublicSettings = {
  profile: { displayName: string; avatarAvailable: boolean; avatarDataUrl?: string | null };
  models: ModelConfiguration[];
  backgroundTasks: BackgroundTaskSettings;
  tokenUsage: TokenUsageEntry[];
};
export type TokenUsageEntry = { date: string; tokens: number };
export type UpdateCheckResult = { status: "latest" | "available"; currentVersion: string; latestVersion: string; releaseName: string; publishedAt: string | null };
export type MultiAgentTaskSummary = import("@ohmycode/protocol").MultiAgentTaskSummary;
export type MultiAgentTemplateMember = import("@ohmycode/protocol").MultiAgentTemplateMember;
export type MultiAgentTemplateTeam = import("@ohmycode/protocol").MultiAgentTemplateTeam;
export type MultiAgentSummary = import("@ohmycode/protocol").MultiAgentSummary;
export type MultiAgentMessage = import("@ohmycode/protocol").MultiAgentMessage;
export type MultiAgentRunDetail = import("@ohmycode/protocol").MultiAgentRunDetail;
export type MultiAgentMemberData = import("@ohmycode/protocol").MultiAgentMemberData;
export type MultiAgentTask = import("@ohmycode/protocol").MultiAgentTask;

export type AgentTask = import("@ohmycode/protocol").AgentTask;
export type RuntimeItem = import("@ohmycode/protocol").RuntimeItem;
export type RuntimeEvent = import("@ohmycode/protocol").RuntimeEvent;
export type TurnSnapshot = import("@ohmycode/protocol").TurnSnapshot;
export type MultiAgentRunEvent = import("@ohmycode/protocol").MultiAgentRunEvent;
export type AgentActivityStep = import("@ohmycode/protocol").AgentActivityStep;
export type MessageAttachment = import("@ohmycode/protocol").MessageAttachment;
export type LocalMessage = import("@ohmycode/protocol").LocalMessage;
export type LocalConversation = import("@ohmycode/protocol").LocalConversation;
export type MessageSearchResult = import("@ohmycode/protocol").MessageSearchResult;
export type ConversationSearchResult = import("@ohmycode/protocol").ConversationSearchResult;
export type LocalProject = import("@ohmycode/protocol").LocalProject;
export type ImageScope = { conversationId: string } | { taskId: string };
