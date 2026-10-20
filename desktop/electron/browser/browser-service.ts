import { BrowserHost } from "@ohmycode/browser-use";
import { BrowserWindow } from "electron";

const hosts = new Map<number, BrowserHost>();

export function browserForWindow(window: BrowserWindow): BrowserHost {
  let host = hosts.get(window.id);
  if (!host) {
    host = new BrowserHost(window, (id, state) => window.webContents.send(`browser:state:${id}`, state));
    hosts.set(window.id, host);
    window.once("closed", () => hosts.delete(window.id));
  }
  return host;
}

export function activeBrowser(): BrowserHost {
  const window = BrowserWindow.getAllWindows()[0];
  if (!window) throw new Error("browser_window_unavailable");
  return browserForWindow(window);
}

export function closeBrowsers(): void {
  for (const host of hosts.values()) host.close();
}
