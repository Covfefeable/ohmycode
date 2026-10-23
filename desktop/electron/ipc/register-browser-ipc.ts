import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import type { BrowserBounds, BrowserCommand } from "@ohmycode/browser-use/types";
import { browserContext, reserveBrowserSpace } from "../browser/browser-service.js";

function windowFor(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("browser_invalid_sender");
  return window;
}

function contextFor(event: IpcMainInvokeEvent, id: string) {
  const context = browserContext(windowFor(event));
  if (context.conversationId && context.conversationId !== id) throw new Error("browser_invalid_conversation");
  return context;
}

export function registerBrowserIpc(): void {
  ipcMain.handle("browser:reserve-space", (event, width: number) => reserveBrowserSpace(windowFor(event), width));
  ipcMain.handle("browser:state", (event, id: string) => contextFor(event, id).host.state(id));
  ipcMain.handle("browser:open", (event, id: string, opened: boolean) => {
    const context = contextFor(event, id);
    if (!opened) context.controller.dock(id);
    return context.host.setOpened(id, opened);
  });
  ipcMain.handle("browser:command", (event, id: string, command: BrowserCommand) => contextFor(event, id).host.command(id, command));
  ipcMain.handle("browser:detach", (event, id: string, detached: boolean) => {
    const context = contextFor(event, id);
    return detached ? context.controller.detach(id) : context.controller.dock(id);
  });
  ipcMain.handle("browser:layout", (event, id: string | null, bounds: BrowserBounds | null) => {
    const window = windowFor(event);
    const context = browserContext(window);
    if (context.conversationId) {
      if (id && id !== context.conversationId) throw new Error("browser_invalid_conversation");
      context.controller.layout(window, bounds);
    } else context.host.layout(id, bounds);
  });
}
