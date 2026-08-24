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
});
