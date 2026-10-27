import { handleInvoke } from "./handle-invoke.js";
import { BrowserWindow, type IpcMainInvokeEvent } from "electron";
import type { BrowserBounds, BrowserCommand } from "@ohmycode/browser-use/types";
import { browserContext } from "../browser/browser-service.js";

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
  handleInvoke("browser:state", (event, id: string) => contextFor(event, id).host.state(id));
  handleInvoke("browser:open", (event, id: string, opened: boolean) => {
    const context = contextFor(event, id);
    if (!opened) context.controller.dock(id);
    return context.host.setOpened(id, opened);
  });
  handleInvoke("browser:command", (event, id: string, command: BrowserCommand) => contextFor(event, id).host.command(id, command));
  handleInvoke("browser:detach", (event, id: string, detached: boolean) => {
    const context = contextFor(event, id);
    return detached ? context.controller.detach(id) : context.controller.dock(id);
  });
  handleInvoke("browser:layout", (event, id: string | null, bounds: BrowserBounds | null) => {
    const window = windowFor(event);
    const context = browserContext(window);
    if (context.conversationId) {
      if (id && id !== context.conversationId) throw new Error("browser_invalid_conversation");
      context.controller.layout(window, bounds);
    } else context.host.layout(id, bounds);
  });
}
