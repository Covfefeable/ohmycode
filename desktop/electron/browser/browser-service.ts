import { BrowserHost } from "@ohmycode/browser-use";
import { BrowserWindow } from "electron";
import { BrowserWindowSpace } from "./browser-window-space.js";
import { DetachedBrowserWindows } from "./detached-browser-window.js";

const hosts = new Map<number, BrowserHost>();
const spaces = new Map<number, BrowserWindowSpace>();
const detached = new Map<number, DetachedBrowserWindows>();

export function browserContext(window: BrowserWindow) {
  for (const [ownerId, controller] of detached) {
    const conversationId = controller.conversationFor(window);
    if (conversationId) return { host: hosts.get(ownerId)!, controller, conversationId };
  }
  const host = browserForWindow(window);
  return { host, controller: detached.get(window.id)!, conversationId: undefined };
}

export function reserveBrowserSpace(window: BrowserWindow, width: number): number {
  let space = spaces.get(window.id);
  if (!space) {
    space = new BrowserWindowSpace(window);
    spaces.set(window.id, space);
    window.once("closed", () => spaces.delete(window.id));
  }
  return space.reserve(width);
}

export function browserForWindow(window: BrowserWindow): BrowserHost {
  let host = hosts.get(window.id);
  if (!host) {
    host = new BrowserHost(window, (id, state) => {
      window.webContents.send(`browser:state:${id}`, state);
      detached.get(window.id)?.publish(id, state);
    });
    hosts.set(window.id, host);
    detached.set(window.id, new DetachedBrowserWindows(window, host));
    window.once("closed", () => { hosts.delete(window.id); detached.delete(window.id); });
  }
  return host;
}

export function activeBrowser(): BrowserHost {
  const existing = hosts.values().next().value;
  if (existing) return existing;
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) throw new Error("browser_window_unavailable");
  return browserForWindow(window);
}

export function closeBrowsers(): void {
  for (const host of hosts.values()) host.close();
}
