interface DesktopBridge {
    operationFeedback: {
      hide(): void;
      onState(callback: (state: import("@ohmycode/tool-contracts").OperationFeedback) => void): () => void;
    };
    android: {
      installPlan(mode?: import("@ohmycode/android-use/types").AndroidInstallMode): Promise<import("@ohmycode/android-use/types").AndroidInstallPlan>;
      installation(): Promise<import("@ohmycode/android-use/types").AndroidInstallState>;
      chooseInstallRoot(mode?: import("@ohmycode/android-use/types").AndroidInstallMode): Promise<import("@ohmycode/android-use/types").AndroidInstallPlan>;
      install(consent: boolean, mode?: import("@ohmycode/android-use/types").AndroidInstallMode): Promise<import("@ohmycode/android-use/types").AndroidInstallState>;
      selectTarget(target: import("@ohmycode/android-use/types").AndroidTarget): Promise<import("@ohmycode/android-use/types").AndroidState>;
      connect(address: string, name: string): Promise<import("@ohmycode/android-use/types").AndroidState>;
      removeDevice(serial: string): Promise<import("@ohmycode/android-use/types").AndroidState>;
      type(conversationId: string, text: string): Promise<void>;
      cancelInstall(): Promise<import("@ohmycode/android-use/types").AndroidInstallState>;
      openLicense(): Promise<void>;
      onInstallation(callback: (state: import("@ohmycode/android-use/types").AndroidInstallState) => void): () => void;
      state(): Promise<import("@ohmycode/android-use/types").AndroidState>;
      refresh(): Promise<import("@ohmycode/android-use/types").AndroidState>;
      chooseSdk(): Promise<import("@ohmycode/android-use/types").AndroidState>;
      setEnabled(enabled: boolean): Promise<import("@ohmycode/android-use/types").AndroidState>;
      openGuide(): Promise<void>;
      start(conversationId: string): Promise<import("@ohmycode/android-use/types").AndroidState>;
      stop(conversationId: string): Promise<import("@ohmycode/android-use/types").AndroidState>;
      detached(): Promise<boolean>;
      setDetached(value: boolean, conversationId: string): Promise<void>;
      onDetached(callback: (value: boolean) => void): () => void;
      startVideo(id: string, conversationId: string): Promise<void>;
      stopVideo(id: string): Promise<void>;
      onVideo(id: string, callback: (packet: import("@ohmycode/android-use").AndroidVideoPacket | { error: string }) => void): () => void;
      act(conversationId: string, action: import("@ohmycode/android-use/types").AndroidAction): Promise<{ ok: true }>;
      touch(conversationId: string, events: import("@ohmycode/android-use/types").AndroidTouch[]): Promise<void>;
      onState(callback: (state: import("@ohmycode/android-use/types").AndroidState) => void): () => void;
    };
    browser: {
      setDetached(id: string, detached: boolean): Promise<void>;
      state(id: string): Promise<import("@ohmycode/browser-use/types").BrowserState>;
      setOpened(id: string, opened: boolean): Promise<import("@ohmycode/browser-use/types").BrowserState>;
      command(id: string, command: import("@ohmycode/browser-use/types").BrowserCommand): Promise<import("@ohmycode/browser-use/types").BrowserState>;
      layout(id: string | null, bounds: import("@ohmycode/browser-use/types").BrowserBounds | null): Promise<void>;
      onState(id: string, callback: (state: import("@ohmycode/browser-use/types").BrowserState) => void): () => void;
    };
    projects: {
      list(): Promise<LocalProject[]>;
      searchConversations(query: string): Promise<ConversationSearchResult[]>;
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
      getRunDetail(messageId: string): Promise<MultiAgentRunDetail>;
      deleteTask(taskId: string): Promise<void>;
      runTask(taskId: string, requestId: string): Promise<MultiAgentTask>;
      stopTask(requestId: string | null, taskId?: string): Promise<void>;
      sendMessage(taskId: string, nodeId: string, content: string): Promise<MultiAgentTask>;
      onEvent(requestId: string, callback: (event: MultiAgentRunEvent) => void): () => void;
    };
    conversations: {
      get(conversationId: string): Promise<LocalConversation>;
      history(conversationId: string, options?: import("./projects/types").ConversationHistoryQuery): Promise<LocalConversation>;
      searchMessages(conversationId: string, options: import("./projects/types").MessageSearchQuery): Promise<MessageSearchResult>;
      branch(conversationId: string, messageId: string): Promise<LocalConversation>;
      startTurn(conversationId: string, content: string, modelId?: string, editMessageId?: string, attachments?: MessageAttachment[]): Promise<{ turnId: string } | { queued: true }>;
      followups(conversationId: string): Promise<import("@ohmycode/protocol").FollowupState>;
      steer(conversationId: string, inputId: string): Promise<void>;
      withdraw(conversationId: string, inputId: string): Promise<import("@ohmycode/protocol").FollowupInput>;
      resumeQueue(conversationId: string): Promise<void>;
      onFollowups(conversationId: string, callback: (state: import("@ohmycode/protocol").FollowupState) => void): () => void;
      resolveDroppedFiles(files: File[]): MessageAttachment[];
      savePastedImage(data: Uint8Array): Promise<MessageAttachment>;
      threadSnapshot(conversationId: string, afterSequence?: number): Promise<TurnSnapshot | null>;
      waitTurn(turnId: string): Promise<LocalConversation | null>;
      interruptTurn(turnId: string, partialMessage?: LocalMessage): Promise<void>;
      onThreadEvent(conversationId: string, callback: (event: RuntimeEvent) => void): () => void;
      suggest(conversationId: string): Promise<string[]>;
    };
    apiStatus(): Promise<{ online: boolean; url: string }>;
    updates: {
      check(): Promise<UpdateCheckResult>;
      openDownload(): Promise<void>;
    };
    debug: {
      contextSnapshot(conversationId: string): Promise<import("./debug/types").ContextSnapshot>;
      getConfig(): Promise<{ apiUrl: string }>;
      setApiUrl(apiUrl: string): Promise<{ apiUrl: string }>;
      openDevTools(): void;
    };
    openPath(targetPath: string, projectId?: string): Promise<void>;
    previewImage(scope: import("./files/image-preview").ImageScope | undefined, reference: string): Promise<string>;
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
      reservePanelSpace(width: number): Promise<number>;
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
    };
    speech: {
      getSettings(): Promise<SpeechSettings>;
      saveSettings(input: SpeechSettingsInput): Promise<SpeechSettings>;
      setAutoPlay(enabled: boolean): Promise<SpeechSettings>;
      listVoices(): Promise<CustomVoice[]>;
      createVoice(input: VoiceCloneInput): Promise<CustomVoice>;
      refreshVoices(): Promise<CustomVoice[]>;
      start(id: string, mode: "asr" | "tts"): Promise<void>;
      append(id: string, value: string | Uint8Array): void;
      finish(id: string): void;
      stop(mode: "asr" | "tts"): void;
      onEvent(id: string, callback: (event: SpeechEvent) => void): () => void;
    };
    settings: {
      get(): Promise<PublicSettings>;
      listModels(): Promise<ModelConfiguration[]>;
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
      removeLocalSkill(id: string): Promise<void>;
      deleteSkill(id: string): Promise<void>;
      onChanged(callback: () => void): () => void;
    };
}

interface Window {
  ohmycode: DesktopBridge;
}

type SpeechSettings = import("./speech/types").SpeechSettings;
type SpeechSettingsInput = import("./speech/types").SpeechSettingsInput;
type SpeechEvent = import("./speech/types").SpeechEvent;
type CustomVoice = import("./speech/types").CustomVoice;
type VoiceCloneInput = import("./speech/types").VoiceCloneInput;

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

type ModelConfiguration = import("./settings/types").ModelInput;
type McpTool = import("./capabilities/types").McpTool;
type McpServerInput = import("./capabilities/types").McpServerInput;
type McpServerRecord = import("./capabilities/types").McpServerRecord;
type SkillRecord = import("./capabilities/types").SkillRecord;
type PublicSettings = {
  profile: { displayName: string; avatarAvailable: boolean; avatarDataUrl?: string | null };
  models: ModelConfiguration[];
  backgroundTasks: BackgroundTaskSettings;
  tokenUsage: TokenUsageEntry[];
};
type TokenUsageEntry = { date: string; tokens: number };
type UpdateCheckResult = { status: "latest" | "available"; currentVersion: string; latestVersion: string; releaseName: string; publishedAt: string | null };
type BackgroundTaskSettings = import("./settings/types").BackgroundTaskSettings;
type MultiAgentTaskSummary = import("@ohmycode/protocol").MultiAgentTaskSummary;
type MultiAgentTemplateMember = import("@ohmycode/protocol").MultiAgentTemplateMember;
type MultiAgentTemplateTeam = import("@ohmycode/protocol").MultiAgentTemplateTeam;
type MultiAgentSummary = import("@ohmycode/protocol").MultiAgentSummary;
type MultiAgentMessage = import("@ohmycode/protocol").MultiAgentMessage;
type MultiAgentRunDetail = import("@ohmycode/protocol").MultiAgentRunDetail;
type MultiAgentMemberData = import("@ohmycode/protocol").MultiAgentMemberData;
type MultiAgentTask = import("@ohmycode/protocol").MultiAgentTask;

type AgentTask = import("@ohmycode/protocol").AgentTask;
type RuntimeItem = import("@ohmycode/protocol").RuntimeItem;
type RuntimeEvent = import("@ohmycode/protocol").RuntimeEvent;
type TurnSnapshot = import("@ohmycode/protocol").TurnSnapshot;
type MultiAgentRunEvent = import("@ohmycode/protocol").MultiAgentRunEvent;
type AgentActivityStep = import("@ohmycode/protocol").AgentActivityStep;
type MessageAttachment = import("@ohmycode/protocol").MessageAttachment;
type LocalMessage = import("@ohmycode/protocol").LocalMessage;
type LocalConversation = import("@ohmycode/protocol").LocalConversation;
type MessageSearchResult = import("@ohmycode/protocol").MessageSearchResult;
type ConversationSearchResult = import("@ohmycode/protocol").ConversationSearchResult;
type LocalProject = import("@ohmycode/protocol").LocalProject;
type TerminalStatus = import("./terminal/types").TerminalStatus;
type TerminalAction = import("./terminal/types").TerminalAction;
type TerminalResult = import("./terminal/types").TerminalResult;
