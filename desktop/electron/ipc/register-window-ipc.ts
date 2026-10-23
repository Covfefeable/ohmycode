import { BrowserWindow, ipcMain } from "electron";

export function registerWindowIpc(): void {
  ipcMain.on("window:minimize", (event) => BrowserWindow.fromWebContents(event.sender)?.minimize());
  ipcMain.on("window:toggle-maximize", (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });
  ipcMain.on("window:close", (event) => BrowserWindow.fromWebContents(event.sender)?.close());
  ipcMain.on("debug:open-devtools", (event) => BrowserWindow.fromWebContents(event.sender)?.webContents.openDevTools({ mode: "detach" }));
}
