import { app, BrowserWindow } from "electron";
import { registerAuthIpc } from "./ipc/register-auth-ipc.js";
import { registerCapabilitiesIpc } from "./ipc/register-capabilities-ipc.js";
import { registerSystemIpc } from "./ipc/register-system-ipc.js";
import { registerSettingsIpc } from "./ipc/register-settings-ipc.js";
import { registerProjectsIpc } from "./ipc/register-projects-ipc.js";
import { registerMultiAgentIpc } from "./ipc/register-multi-agent-ipc.js";
import { stopAllTerminals } from "./terminal/terminal-manager.js";
import { closeMcpSessions } from "./capabilities/mcp-manager.js";
import { createMainWindow } from "./window/create-main-window.js";
import { closeAgentRuntime, initializeAgentRuntime } from "./runtime/desktop-runtime-host.js";

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (process.platform === "win32") app.setAppUserModelId("com.ohmycode.desktop");

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) {
      void createMainWindow();
      return;
    }
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  });

  app.whenReady().then(() => {
    initializeAgentRuntime();
    registerAuthIpc();
    registerCapabilitiesIpc();
    registerSystemIpc();
    registerSettingsIpc();
    registerProjectsIpc();
    registerMultiAgentIpc();
    void createMainWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  closeAgentRuntime();
  stopAllTerminals();
  void closeMcpSessions();
});
