import path from "node:path";
import { BrowserWindow, ipcMain, shell } from "electron";
import { getApiUrl, setApiUrl } from "../config.js";
import { safeExistingPath } from "../files/workspace.js";
import { listProjects } from "../projects/projects-service.js";

export function registerSystemIpc(): void {
  ipcMain.handle("api:status", async () => {
    const apiUrl = getApiUrl();
    try {
      const response = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(3_000) });
      return { online: response.ok, url: apiUrl };
    } catch {
      return { online: false, url: apiUrl };
    }
  });
  ipcMain.handle("debug:get-config", () => ({ apiUrl: getApiUrl() }));
  ipcMain.handle("debug:set-api-url", (_event, apiUrl: string) => ({ apiUrl: setApiUrl(apiUrl) }));
  ipcMain.on("debug:open-devtools", (event) => BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: "detach" }));
  ipcMain.handle("system:open-path", async (_event, targetPath: string, projectId?: string) => {
    if (!targetPath.trim()) throw new Error("path_required");
    let resolvedPath = targetPath;
    if (!path.isAbsolute(targetPath)) {
      const project = (await listProjects()).find((item) => item.id === projectId);
      if (!project) throw new Error("project_not_found");
      resolvedPath = await safeExistingPath(project.path, targetPath);
    }
    const error = await shell.openPath(resolvedPath);
    if (error) throw new Error(error);
  });
  ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
}
