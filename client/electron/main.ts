import { app, BrowserWindow } from "electron";
import { startApiSidecar, stopApiSidecar } from "./api/sidecar.js";
import { registerAuthIpc } from "./ipc/register-auth-ipc.js";
import { registerSystemIpc } from "./ipc/register-system-ipc.js";
import { registerSettingsIpc } from "./ipc/register-settings-ipc.js";
import { registerProjectsIpc } from "./ipc/register-projects-ipc.js";
import { createMainWindow } from "./window/create-main-window.js";

app.whenReady().then(async () => {
  await startApiSidecar();
  registerAuthIpc();
  registerSystemIpc();
  registerSettingsIpc();
  registerProjectsIpc();
  void createMainWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createMainWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  stopApiSidecar();
});
