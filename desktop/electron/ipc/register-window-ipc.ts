import { handleInvoke } from "./handle-invoke.js";
import { BrowserWindow, ipcMain } from "electron";
import { reservePanelSpace } from "../window/panel-window-space.js";

export function registerWindowIpc(): void {
  handleInvoke("window:reserve-panel-space", (event, width: number) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window || event.senderFrame !== window.webContents.mainFrame) throw new Error("window_invalid_sender");
    return reservePanelSpace(window, width);
  });
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
