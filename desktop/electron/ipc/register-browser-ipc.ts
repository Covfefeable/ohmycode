import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { BrowserBounds, BrowserCommand } from "@ohmycode/browser-use/types";
import { browserForWindow, reserveBrowserSpace } from "../browser/browser-service.js";

function windowFor(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("browser_invalid_sender");
  return window;
}

const hostFor = (event: IpcMainInvokeEvent) => browserForWindow(windowFor(event));

export function registerBrowserIpc(): void {
  ipcMain.handle("browser:reserve-space", (event, width: number) => reserveBrowserSpace(windowFor(event), width));
  ipcMain.handle("browser:state", (event, id: string) => hostFor(event).state(id));
  ipcMain.handle("browser:open", (event, id: string, opened: boolean) => hostFor(event).setOpened(id, opened));
  ipcMain.handle("browser:command", (event, id: string, command: BrowserCommand) => hostFor(event).command(id, command));
  ipcMain.handle("browser:layout", (event, id: string | null, bounds: BrowserBounds | null) => hostFor(event).layout(id, bounds));
}
