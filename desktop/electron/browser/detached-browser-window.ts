import type { BrowserWindow } from "electron";
import type { BrowserHost } from "@ohmycode/browser-use";
import type { BrowserBounds, BrowserState } from "@ohmycode/browser-use/types";
import { createApplicationWindow } from "../window/create-main-window.js";

/** The host retains tab ownership; this controller only owns their presentation window. */
export class DetachedBrowserWindows {
  private readonly windows = new Map<string, BrowserWindow>();

  constructor(private readonly owner: BrowserWindow, private readonly host: BrowserHost) {}

  conversationFor(window: BrowserWindow): string | undefined {
    return [...this.windows].find(([, candidate]) => candidate === window)?.[0];
  }

  publish(id: string, state: BrowserState): void {
    this.windows.get(id)?.webContents.send(`browser:state:${id}`, state);
  }

  layout(window: BrowserWindow, bounds: BrowserBounds | null): void {
    const id = this.conversationFor(window);
    if (id) this.host.layoutDetached(id, bounds);
  }

  async detach(id: string): Promise<void> {
    const existing = this.windows.get(id);
    if (existing) { existing.show(); existing.focus(); return; }
    const window = await createApplicationWindow({ width: 1000, height: 800, show: false }, `/browser/${encodeURIComponent(id)}`, (window) => {
      this.windows.set(id, window);
      window.on("close", () => {
        this.windows.delete(id);
        if (!this.owner.isDestroyed() && this.host.state(id).detached) this.host.setDetachedWindow(id, null);
      });
      window.once("closed", () => this.windows.delete(id));
      const close = () => { if (!window.isDestroyed()) window.destroy(); };
      this.owner.once("closed", close);
      window.once("closed", () => this.owner.removeListener("closed", close));
      this.host.setDetachedWindow(id, window);
    });
    if (!window.isDestroyed()) window.show();
  }

  dock(id: string): void {
    this.windows.get(id)?.close();
  }
}
