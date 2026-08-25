import { app, BrowserWindow } from "electron";
import { startApiSidecar, stopApiSidecar } from "./api/sidecar.js";
import { registerAuthIpc } from "./ipc/register-auth-ipc.js";
import { registerSystemIpc } from "./ipc/register-system-ipc.js";
import { registerSettingsIpc } from "./ipc/register-settings-ipc.js";
import { registerProjectsIpc } from "./ipc/register-projects-ipc.js";
import { registerMultiAgentIpc } from "./ipc/register-multi-agent-ipc.js";
import { stopAllTerminals } from "./terminal/terminal-manager.js";
import { createMainWindow } from "./window/create-main-window.js";

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
    registerAuthIpc();
    registerSystemIpc();
    registerSettingsIpc();
    registerProjectsIpc();
    registerMultiAgentIpc();
    void createMainWindow();
    void startApiSidecar().catch((error) => {
      console.error("[api] failed to initialize sidecar", error);
    });
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopAllTerminals();
  stopApiSidecar();
});
