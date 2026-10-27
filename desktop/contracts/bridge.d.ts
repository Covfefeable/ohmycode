import type * as Domain from "./domain.js";

export interface DesktopBridge {
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
      act(conversationId: string, action: import("@ohmycode/android-use/types").AndroidAction): Promise<void>;
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
      list(): Promise<Domain.LocalProject[]>;
      searchConversations(query: string): Promise<Domain.ConversationSearchResult[]>;
      create(): Promise<{ ok: true; project: Domain.LocalProject } | { ok: false; reason: "canceled" | "exists" }>;
      open(projectId: string): Promise<void>;
      delete(projectId: string): Promise<void>;
      createConversation(projectId: string, title: string): Promise<Domain.LocalConversation>;
      deleteConversation(projectId: string, conversationId: string): Promise<void>;
    };
    multiAgents: {
      list(): Promise<Domain.MultiAgentSummary[]>;
      create(payload: { name: string; description: string; division: string }): Promise<Domain.MultiAgentSummary>;
      update(agentId: string, payload: Partial<Domain.MultiAgentSummary>): Promise<Domain.MultiAgentSummary>;
      delete(agentId: string): Promise<void>;
      selectWorkspace(): Promise<string | null>;
      createTask(agentId: string, request: string, workspacePath: string, executionLimit: number): Promise<Domain.MultiAgentTask>;
      getTask(taskId: string): Promise<Domain.MultiAgentTask>;
      getRunDetail(messageId: string): Promise<Domain.MultiAgentRunDetail>;
      deleteTask(taskId: string): Promise<void>;
      runTask(taskId: string, requestId: string): Promise<Domain.MultiAgentTask>;
      stopTask(requestId: string | null, taskId?: string): Promise<void>;
      sendMessage(taskId: string, nodeId: string, content: string): Promise<Domain.MultiAgentTask>;
      onEvent(requestId: string, callback: (event: Domain.MultiAgentRunEvent) => void): () => void;
    };
    conversations: {
      get(conversationId: string): Promise<Domain.LocalConversation>;
      history(conversationId: string, options?: import("@ohmycode/protocol").ConversationHistoryQuery): Promise<Domain.LocalConversation>;
      searchMessages(conversationId: string, options: import("@ohmycode/protocol").MessageSearchQuery): Promise<Domain.MessageSearchResult>;
      branch(conversationId: string, messageId: string): Promise<Domain.LocalConversation>;
      startTurn(conversationId: string, content: string, modelId?: string, editMessageId?: string, attachments?: Domain.MessageAttachment[]): Promise<{ turnId: string } | { queued: true }>;
      followups(conversationId: string): Promise<import("@ohmycode/protocol").FollowupState>;
      steer(conversationId: string, inputId: string): Promise<void>;
      withdraw(conversationId: string, inputId: string): Promise<import("@ohmycode/protocol").FollowupInput>;
      resumeQueue(conversationId: string): Promise<void>;
      onFollowups(conversationId: string, callback: (state: import("@ohmycode/protocol").FollowupState) => void): () => void;
      resolveDroppedFiles(files: File[]): Domain.MessageAttachment[];
      savePastedImage(data: Uint8Array): Promise<Domain.MessageAttachment>;
      threadSnapshot(conversationId: string, afterSequence?: number): Promise<Domain.TurnSnapshot | null>;
      waitTurn(turnId: string): Promise<Domain.LocalConversation | null>;
      interruptTurn(turnId: string, partialMessage?: Domain.LocalMessage): Promise<void>;
      onThreadEvent(conversationId: string, callback: (event: Domain.RuntimeEvent) => void): () => void;
      suggest(conversationId: string): Promise<string[]>;
    };
    apiStatus(): Promise<{ online: boolean; url: string }>;
    updates: {
      check(): Promise<Domain.UpdateCheckResult>;
      openDownload(): Promise<void>;
    };
    debug: {
      contextSnapshot(conversationId: string): Promise<Domain.ContextSnapshot>;
      getConfig(): Promise<{ apiUrl: string }>;
      setApiUrl(apiUrl: string): Promise<{ apiUrl: string }>;
      openDevTools(): void;
    };
    openPath(targetPath: string, projectId?: string): Promise<void>;
    previewImage(scope: Domain.ImageScope | undefined, reference: string): Promise<string>;
    auth: {
      bootstrap(): Promise<Domain.AuthBootstrap>;
      login(payload: Domain.LoginPayload): Promise<Domain.AuthResponse>;
      register(payload: Domain.RegistrationPayload): Promise<Domain.AuthResponse>;
      logout(): Promise<void>;
    };
    windowControls: {
      reservePanelSpace(width: number): Promise<number>;
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
    };
    speech: {
      getSettings(): Promise<Domain.SpeechSettings>;
      saveSettings(input: Domain.SpeechSettingsInput): Promise<Domain.SpeechSettings>;
      setAutoPlay(enabled: boolean): Promise<Domain.SpeechSettings>;
      listVoices(): Promise<Domain.CustomVoice[]>;
      createVoice(input: Domain.VoiceCloneInput): Promise<Domain.CustomVoice>;
      refreshVoices(): Promise<Domain.CustomVoice[]>;
      start(id: string, mode: "asr" | "tts"): Promise<void>;
      append(id: string, value: string | Uint8Array): void;
      finish(id: string): void;
      stop(mode: "asr" | "tts"): void;
      onEvent(id: string, callback: (event: Domain.SpeechEvent) => void): () => void;
    };
    settings: {
      get(): Promise<Domain.PublicSettings>;
      listModels(): Promise<Domain.ModelConfiguration[]>;
      saveProfile(displayName: string): Promise<Domain.PublicSettings["profile"]>;
      saveAvatar(data: string, contentType: string): Promise<Domain.PublicSettings["profile"]>;
      onProfileChanged(callback: (profile: Domain.PublicSettings["profile"]) => void): () => void;
      saveModels(models: Domain.ModelConfiguration[]): Promise<Domain.ModelConfiguration[]>;
      saveBackgroundTasks(settings: Domain.BackgroundTaskSettings): Promise<Domain.BackgroundTaskSettings>;
      onModelsChanged(callback: (models: Domain.ModelConfiguration[]) => void): () => void;
      testModel(model: Domain.ModelConfiguration): Promise<{ ok: boolean; latencyMs?: number; message?: string }>;
    };
    capabilities: {
      listMcp(): Promise<Domain.McpServerRecord[]>;
      saveMcp(input: Domain.McpServerInput): Promise<Domain.McpServerRecord>;
      testMcp(id: string): Promise<Domain.McpServerRecord>;
      deleteMcp(id: string): Promise<void>;
      listSkills(): Promise<Domain.SkillRecord[]>;
      installSkill(): Promise<Domain.SkillRecord | null>;
      downloadSkill(id: string): Promise<Domain.SkillRecord>;
      removeLocalSkill(id: string): Promise<void>;
      deleteSkill(id: string): Promise<void>;
      onChanged(callback: () => void): () => void;
    };
}
