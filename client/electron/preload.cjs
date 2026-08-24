const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ohmycode", {
  selectWorkspace: () => ipcRenderer.invoke("workspace:select"),
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
