import { BrowserWindow, dialog, ipcMain } from "electron";
import { API_URL } from "../config.js";

export function registerSystemIpc(): void {
  ipcMain.handle("workspace:select", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? null : result.filePaths[0];
  });
  ipcMain.handle("api:status", async () => {
    try {
      const response = await fetch(`${API_URL}/api/health`);
      return { online: response.ok, url: API_URL };
    } catch {
      return { online: false, url: API_URL };
    }
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
