import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from "electron";

import type { DesktopInvocations } from "../contracts/invocations.js";

function invokeDesktop<K extends keyof DesktopInvocations>(channel: K, ...args: Parameters<DesktopInvocations[K]>): ReturnType<DesktopInvocations[K]> {
  return ipcRenderer.invoke(channel, ...args) as ReturnType<DesktopInvocations[K]>;
}

let operationState: import("@ohmycode/tool-contracts").OperationFeedback = { active: false };
const operationListeners = new Set<(state: typeof operationState) => void>();
ipcRenderer.on("operation:state", (_event, state: typeof operationState) => {
  operationState = state;
  for (const listener of operationListeners) listener(state);
});

const bridge: DesktopBridge = {
  operationFeedback: {
    hide: () => ipcRenderer.send("operation:hide"),
    onState(callback) {
      operationListeners.add(callback);
      callback(operationState);
      return () => { operationListeners.delete(callback); };
    },
  },
  android: {
    installPlan: (mode) => invokeDesktop("android:install-plan", mode),
    installation: () => invokeDesktop("android:installation"),
    chooseInstallRoot: (mode) => invokeDesktop("android:install-root", mode),
    install: (consent, mode) => invokeDesktop("android:install", consent, mode),
    selectTarget: (target) => invokeDesktop("android:select-target", target),
    connect: (address, name) => invokeDesktop("android:connect", address, name),
    removeDevice: (serial) => invokeDesktop("android:remove-device", serial),
    type: (conversationId, text) => invokeDesktop("android:type", conversationId, text),
    cancelInstall: () => invokeDesktop("android:cancel-install"),
    openLicense: () => invokeDesktop("android:license"),
    onInstallation: (callback) => {
      const listener = (_event: IpcRendererEvent, state: import("@ohmycode/android-use/types").AndroidInstallState) => callback(state);
      ipcRenderer.on("android:installation", listener);
      return () => ipcRenderer.removeListener("android:installation", listener);
    },
    state: () => invokeDesktop("android:state"),
    refresh: () => invokeDesktop("android:refresh"),
    chooseSdk: () => invokeDesktop("android:choose-sdk"),
    setEnabled: (enabled) => invokeDesktop("android:enabled", enabled),
    openGuide: () => invokeDesktop("android:guide"),
    start: (conversationId) => invokeDesktop("android:start", conversationId),
    stop: (conversationId) => invokeDesktop("android:stop", conversationId),
    detached: () => invokeDesktop("android:detached"),
    setDetached: (value, conversationId) => invokeDesktop("android:set-detached", value, conversationId),
    onDetached: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: boolean) => callback(value);
      ipcRenderer.on("android:detached", listener);
      return () => ipcRenderer.removeListener("android:detached", listener);
    },
    startVideo: (id, conversationId) => invokeDesktop("android:video-start", id, conversationId),
    stopVideo: (id) => invokeDesktop("android:video-stop", id),
    onVideo: (id, callback) => {
      const listener = (_event: Electron.IpcRendererEvent, session: string, packet: Parameters<typeof callback>[0]) => { if (id === session) callback(packet); };
      ipcRenderer.on("android:video", listener);
      return () => ipcRenderer.removeListener("android:video", listener);
    },
    act: (conversationId, action) => invokeDesktop("android:act", conversationId, action),
    touch: (conversationId, events) => invokeDesktop("android:touch", conversationId, events),
    onState: (callback) => {
      const listener = (_event: IpcRendererEvent, state: import("@ohmycode/android-use/types").AndroidState) => callback(state);
      ipcRenderer.on("android:state", listener);
      return () => ipcRenderer.removeListener("android:state", listener);
    },
  },
  browser: {
    setDetached: (id, detached) => invokeDesktop("browser:detach", id, detached),
    state: (id) => invokeDesktop("browser:state", id),
    setOpened: (id, opened) => invokeDesktop("browser:open", id, opened),
    command: (id, command) => invokeDesktop("browser:command", id, command),
    layout: (id, bounds) => invokeDesktop("browser:layout", id, bounds),
    onState: (id, callback) => {
      const channel = `browser:state:${id}`;
      const listener = (_event: IpcRendererEvent, state: import("@ohmycode/browser-use/types").BrowserState) => callback(state);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  projects: {
    list: () => invokeDesktop("projects:list"),
    searchConversations: (query) => invokeDesktop("projects:search-conversations", query),
    create: () => invokeDesktop("projects:create"),
    open: (projectId) => invokeDesktop("projects:open", projectId),
    delete: (projectId) => invokeDesktop("projects:delete", projectId),
    createConversation: (projectId, title) => invokeDesktop("projects:create-conversation", projectId, title),
    deleteConversation: (projectId, conversationId) => invokeDesktop("projects:delete-conversation", projectId, conversationId),
  },
  multiAgents: {
    list: () => invokeDesktop("multi-agents:list"),
    create: (payload) => invokeDesktop("multi-agents:create", payload),
    update: (agentId, payload) => invokeDesktop("multi-agents:update", agentId, payload),
    delete: (agentId) => invokeDesktop("multi-agents:delete", agentId),
    selectWorkspace: () => invokeDesktop("multi-agents:select-workspace"),
    createTask: (agentId, request, workspacePath, executionLimit) => invokeDesktop("multi-agents:create-task", agentId, request, workspacePath, executionLimit),
    getTask: (taskId) => invokeDesktop("multi-agents:get-task", taskId),
    getRunDetail: (messageId) => invokeDesktop("multi-agents:get-run-detail", messageId),
    deleteTask: (taskId) => invokeDesktop("multi-agents:delete-task", taskId),
    runTask: (taskId, requestId) => invokeDesktop("multi-agents:run-task", taskId, requestId),
    stopTask: (requestId, taskId) => invokeDesktop("multi-agents:stop-task", requestId, taskId),
    sendMessage: (taskId, nodeId, content) => invokeDesktop("multi-agents:send-message", taskId, nodeId, content),
    onEvent: (requestId, callback) => {
      const channel = `multi-agent:event:${requestId}`;
      const listener = (_event: IpcRendererEvent, streamEvent: MultiAgentRunEvent) => callback(streamEvent);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  conversations: {
    get: (conversationId) => invokeDesktop("conversations:get", conversationId),
    history: (conversationId, options) => invokeDesktop("conversations:history", conversationId, options),
    searchMessages: (conversationId, options) => invokeDesktop("conversations:search-messages", conversationId, options),
    branch: (conversationId, messageId) => invokeDesktop("conversations:branch", conversationId, messageId),
    startTurn: (conversationId, content, modelId, editMessageId, attachments) => invokeDesktop("conversations:start-turn", conversationId, content, modelId, editMessageId, attachments),
    followups: (id) => invokeDesktop("conversations:followups", id),
    steer: (id, inputId) => invokeDesktop("conversations:steer", id, inputId),
    withdraw: (id, inputId) => invokeDesktop("conversations:withdraw", id, inputId),
    resumeQueue: (id) => invokeDesktop("conversations:resume-queue", id),
    onFollowups: (id, callback) => {
      const channel = `thread:followups:${id}`;
      const listener = (_event: Electron.IpcRendererEvent, state: import("@ohmycode/protocol").FollowupState) => callback(state);
      ipcRenderer.on(channel, listener);
      return () => { ipcRenderer.removeListener(channel, listener); };
    },
    resolveDroppedFiles: (files) => files.map((file) => ({
      id: globalThis.crypto.randomUUID(),
      name: file.name,
      path: webUtils.getPathForFile(file),
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    })),
    savePastedImage: (data) => invokeDesktop("conversations:save-pasted-image", data),
    threadSnapshot: (conversationId, afterSequence) => invokeDesktop("conversations:thread-snapshot", conversationId, afterSequence),
    waitTurn: (turnId) => invokeDesktop("conversations:wait-turn", turnId),
    interruptTurn: (turnId, partialMessage) => invokeDesktop("conversations:interrupt-turn", turnId, partialMessage),
    onThreadEvent: (conversationId, callback) => {
      const channel = `thread:event:${conversationId}`;
      const listener = (_event: IpcRendererEvent, runtimeEvent: RuntimeEvent) => callback(runtimeEvent);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
    suggest: (conversationId) => invokeDesktop("conversations:suggest", conversationId),
  },
  apiStatus: () => invokeDesktop("api:status"),
  updates: {
    check: () => invokeDesktop("updates:check"),
    openDownload: () => invokeDesktop("updates:open-download"),
  },
  debug: {
    contextSnapshot: (conversationId) => invokeDesktop("debug:context-snapshot", conversationId),
    getConfig: () => invokeDesktop("debug:get-config"),
    setApiUrl: (apiUrl) => invokeDesktop("debug:set-api-url", apiUrl),
    openDevTools: () => ipcRenderer.send("debug:open-devtools"),
  },
  openPath: (targetPath, projectId) => invokeDesktop("system:open-path", targetPath, projectId),
  previewImage: (scope, reference) => invokeDesktop("images:preview", scope, reference),
  auth: {
    bootstrap: () => invokeDesktop("auth:bootstrap"),
    login: (payload) => invokeDesktop("auth:login", payload),
    register: (payload) => invokeDesktop("auth:register", payload),
    logout: () => invokeDesktop("auth:logout"),
  },
  windowControls: {
    reservePanelSpace: (width) => invokeDesktop("window:reserve-panel-space", width),
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
  speech: {
    getSettings: () => invokeDesktop("speech:settings"),
    saveSettings: (input) => invokeDesktop("speech:save", input),
    setAutoPlay: (enabled) => invokeDesktop("speech:auto-play", enabled),
    listVoices: () => invokeDesktop("speech:voices"),
    createVoice: (input) => invokeDesktop("speech:clone-voice", input),
    refreshVoices: () => invokeDesktop("speech:refresh-voices"),
    start: (id, mode) => invokeDesktop("speech:start", id, mode),
    append: (id, value) => ipcRenderer.send("speech:append", id, value),
    finish: (id) => ipcRenderer.send("speech:finish", id),
    stop: (mode) => ipcRenderer.send("speech:stop", mode),
    onEvent: (id, callback) => {
      const channel = `speech:event:${id}`;
      const listener = (_event: IpcRendererEvent, event: SpeechEvent) => callback(event);
      ipcRenderer.on(channel, listener);
      return () => { ipcRenderer.removeListener(channel, listener); };
    },
  },
  settings: {
    get: () => invokeDesktop("settings:get"),
    listModels: () => invokeDesktop("settings:list-models"),
    saveProfile: (displayName) => invokeDesktop("settings:save-profile", displayName),
    saveAvatar: (data, contentType) => invokeDesktop("settings:save-avatar", data, contentType),
    onProfileChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, profile: PublicSettings["profile"]) => callback(profile);
      ipcRenderer.on("settings:profile-changed", listener);
      return () => ipcRenderer.removeListener("settings:profile-changed", listener);
    },
    saveModels: (models) => invokeDesktop("settings:save-models", models),
    saveBackgroundTasks: (settings) => invokeDesktop("settings:save-background-tasks", settings),
    onModelsChanged: (callback) => {
      const listener = (_event: IpcRendererEvent, models: ModelConfiguration[]) => callback(models);
      ipcRenderer.on("settings:models-changed", listener);
      return () => ipcRenderer.removeListener("settings:models-changed", listener);
    },
    testModel: (model) => invokeDesktop("settings:test-model", model),
  },
  capabilities: {
    listMcp: () => invokeDesktop("capabilities:mcp-list"),
    saveMcp: (input) => invokeDesktop("capabilities:mcp-save", input),
    testMcp: (id) => invokeDesktop("capabilities:mcp-test", id),
    deleteMcp: (id) => invokeDesktop("capabilities:mcp-delete", id),
    listSkills: () => invokeDesktop("capabilities:skills-list"),
    installSkill: () => invokeDesktop("capabilities:skills-install"),
    downloadSkill: (id) => invokeDesktop("capabilities:skills-download", id),
    removeLocalSkill: (id) => invokeDesktop("capabilities:skills-remove-local", id),
    deleteSkill: (id) => invokeDesktop("capabilities:skills-delete", id),
    onChanged: (callback) => {
      const listener = () => callback();
      ipcRenderer.on("capabilities:changed", listener);
      return () => ipcRenderer.removeListener("capabilities:changed", listener);
    },
  },
};

contextBridge.exposeInMainWorld("ohmycode", bridge);
