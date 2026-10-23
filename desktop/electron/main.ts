import { app, BrowserWindow } from "electron";
import { registerAuthIpc } from "./ipc/register-auth-ipc.js";
import { registerBrowserIpc } from "./ipc/register-browser-ipc.js";
import { closeBrowsers } from "./browser/browser-service.js";
import { registerCapabilitiesIpc } from "./ipc/register-capabilities-ipc.js";
import { registerApiIpc } from "./ipc/register-api-ipc.js";
import { registerFilesIpc } from "./ipc/register-files-ipc.js";
import { registerWindowIpc } from "./ipc/register-window-ipc.js";
import { registerSettingsIpc } from "./ipc/register-settings-ipc.js";
import { registerProjectsIpc } from "./ipc/register-projects-ipc.js";
import { registerMultiAgentIpc } from "./ipc/register-multi-agent-ipc.js";
import { registerUpdateIpc } from "./ipc/register-update-ipc.js";
import { registerSpeechIpc } from "./ipc/register-speech-ipc.js";
import { stopSpeech } from "./speech/speech-host.js";
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
    registerBrowserIpc();
    registerCapabilitiesIpc();
    registerApiIpc();
    registerFilesIpc();
    registerWindowIpc();
    registerSettingsIpc();
    registerProjectsIpc();
    registerMultiAgentIpc();
    registerUpdateIpc();
    registerSpeechIpc();
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
  closeBrowsers();
  stopSpeech();
  closeAgentRuntime();
  stopAllTerminals();
  void closeMcpSessions();
});
