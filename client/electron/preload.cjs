const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("ohmycode", {
  projects: {
    list: () => ipcRenderer.invoke("projects:list"),
    create: () => ipcRenderer.invoke("projects:create"),
    open: (projectId) => ipcRenderer.invoke("projects:open", projectId),
    delete: (projectId) => ipcRenderer.invoke("projects:delete", projectId),
    createConversation: (projectId, title) => ipcRenderer.invoke("projects:create-conversation", projectId, title),
    deleteConversation: (projectId, conversationId) => ipcRenderer.invoke("projects:delete-conversation", projectId, conversationId),
  },
  multiAgents: {
    list: () => ipcRenderer.invoke("multi-agents:list"),
    create: (payload) => ipcRenderer.invoke("multi-agents:create", payload),
    update: (agentId, payload) => ipcRenderer.invoke("multi-agents:update", agentId, payload),
    delete: (agentId) => ipcRenderer.invoke("multi-agents:delete", agentId),
    selectWorkspace: () => ipcRenderer.invoke("multi-agents:select-workspace"),
    createTask: (agentId, request, workspacePath) => ipcRenderer.invoke("multi-agents:create-task", agentId, request, workspacePath),
    getTask: (taskId) => ipcRenderer.invoke("multi-agents:get-task", taskId),
    deleteTask: (taskId) => ipcRenderer.invoke("multi-agents:delete-task", taskId),
    runTask: (taskId, requestId) => ipcRenderer.invoke("multi-agents:run-task", taskId, requestId),
    stopTask: (requestId, taskId) => ipcRenderer.invoke("multi-agents:stop-task", requestId, taskId),
    sendMessage: (taskId, nodeId, content) => ipcRenderer.invoke("multi-agents:send-message", taskId, nodeId, content),
    onEvent: (requestId, callback) => {
      const channel = `multi-agent:event:${requestId}`;
      const listener = (_event, streamEvent) => callback(streamEvent);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  conversations: {
    get: (conversationId) => ipcRenderer.invoke("conversations:get", conversationId),
    startTurn: (conversationId, content, modelId, editMessageId, attachments) => ipcRenderer.invoke("conversations:start-turn", conversationId, content, modelId, editMessageId, attachments),
    resolveDroppedFiles: (files) => files.map((file) => ({
      id: globalThis.crypto.randomUUID(),
      name: file.name,
      path: webUtils.getPathForFile(file),
      size: file.size,
      mimeType: file.type || "application/octet-stream",
    })),
    threadSnapshot: (conversationId, afterSequence) => ipcRenderer.invoke("conversations:thread-snapshot", conversationId, afterSequence),
    waitTurn: (turnId) => ipcRenderer.invoke("conversations:wait-turn", turnId),
    interruptTurn: (turnId, partialMessage) => ipcRenderer.invoke("conversations:interrupt-turn", turnId, partialMessage),
    onThreadEvent: (conversationId, callback) => {
      const channel = `thread:event:${conversationId}`;
      const listener = (_event, runtimeEvent) => callback(runtimeEvent);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  apiStatus: () => ipcRenderer.invoke("api:status"),
  debug: {
    getConfig: () => ipcRenderer.invoke("debug:get-config"),
    setApiUrl: (apiUrl) => ipcRenderer.invoke("debug:set-api-url", apiUrl),
    openDevTools: () => ipcRenderer.send("debug:open-devtools"),
  },
  openPath: (targetPath, projectId) => ipcRenderer.invoke("system:open-path", targetPath, projectId),
  auth: {
    bootstrap: () => ipcRenderer.invoke("auth:bootstrap"),
    login: (payload) => ipcRenderer.invoke("auth:login", payload),
    register: (payload) => ipcRenderer.invoke("auth:register", payload),
    logout: () => ipcRenderer.invoke("auth:logout"),
  },
  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    toggleMaximize: () => ipcRenderer.send("window:toggle-maximize"),
    close: () => ipcRenderer.send("window:close"),
  },
  settings: {
    get: () => ipcRenderer.invoke("settings:get"),
    saveProfile: (displayName) => ipcRenderer.invoke("settings:save-profile", displayName),
    saveAvatar: (data, contentType) => ipcRenderer.invoke("settings:save-avatar", data, contentType),
    saveModels: (models) => ipcRenderer.invoke("settings:save-models", models),
    testModel: (model) => ipcRenderer.invoke("settings:test-model", model),
  },
  capabilities: {
    listMcp: () => ipcRenderer.invoke("capabilities:mcp-list"),
    saveMcp: (input) => ipcRenderer.invoke("capabilities:mcp-save", input),
    testMcp: (id) => ipcRenderer.invoke("capabilities:mcp-test", id),
    deleteMcp: (id) => ipcRenderer.invoke("capabilities:mcp-delete", id),
    listSkills: () => ipcRenderer.invoke("capabilities:skills-list"),
    installSkill: () => ipcRenderer.invoke("capabilities:skills-install"),
    downloadSkill: (id) => ipcRenderer.invoke("capabilities:skills-download", id),
    removeLocalSkill: (name) => ipcRenderer.invoke("capabilities:skills-remove-local", name),
    deleteSkill: (id, name) => ipcRenderer.invoke("capabilities:skills-delete", id, name),
  },
});
