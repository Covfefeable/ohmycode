const { contextBridge, ipcRenderer } = require("electron");

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
    saveFlow: (taskId, positions) => ipcRenderer.invoke("multi-agents:save-flow", taskId, positions),
    deleteTask: (taskId) => ipcRenderer.invoke("multi-agents:delete-task", taskId),
    runTask: (taskId, requestId) => ipcRenderer.invoke("multi-agents:run-task", taskId, requestId),
    stopTask: (requestId) => ipcRenderer.invoke("multi-agents:stop-task", requestId),
    onEvent: (requestId, callback) => {
      const channel = `multi-agent:event:${requestId}`;
      const listener = (_event, streamEvent) => callback(streamEvent);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  conversations: {
    get: (conversationId) => ipcRenderer.invoke("conversations:get", conversationId),
    send: (conversationId, content, modelId, requestId, editMessageId) => ipcRenderer.invoke("conversations:send", conversationId, content, modelId, requestId, editMessageId),
    stop: (requestId, partialMessage) => ipcRenderer.invoke("conversations:stop", requestId, partialMessage),
    onEvent: (requestId, callback) => {
      const channel = `conversation:event:${requestId}`;
      const listener = (_event, streamEvent) => callback(streamEvent);
      ipcRenderer.on(channel, listener);
      return () => ipcRenderer.removeListener(channel, listener);
    },
  },
  apiStatus: () => ipcRenderer.invoke("api:status"),
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
    saveModels: (models) => ipcRenderer.invoke("settings:save-models", models),
    testModel: (model) => ipcRenderer.invoke("settings:test-model", model),
  },
  terminal: {
    execute: (action) => ipcRenderer.invoke("terminal:execute", action),
  },
});
