import { app, WebContentsView, type BrowserWindow, type WebContents } from "electron";
import path from "node:path";
import type { BrowserBounds } from "@ohmycode/browser-use/types";
import type { OperationFeedback } from "@ohmycode/tool-contracts";

/** A trusted application view above the guest page, never injected into websites. */
export class NativeOperationOverlay {
  private readonly view = new WebContentsView({ webPreferences: {
    preload: path.join(app.getAppPath(), "dist-electron/preload.cjs"),
    contextIsolation: true, sandbox: true, nodeIntegration: false,
  } });
  private owner: BrowserWindow | null = null;
  private feedback: OperationFeedback = { active: false };
  private page?: WebContents;
  readonly ready: Promise<void>;

  constructor() {
    this.view.setBackgroundColor("#00000000");
    this.view.setVisible(false);
    this.view.webContents.ipc.on("operation:hide", () => {
      if (!this.feedback.active) this.hide();
    });
    this.view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.view.webContents.on("will-navigate", (event) => event.preventDefault());
    const hash = "/operation-overlay";
    if (process.env.VITE_DEV_SERVER_URL) {
      const url = new URL(process.env.VITE_DEV_SERVER_URL);
      url.hash = hash;
      this.ready = this.view.webContents.loadURL(url.href);
    } else this.ready = this.view.webContents.loadFile(path.join(app.getAppPath(), "dist/index.html"), { hash });
  }

  update(owner: BrowserWindow | null, bounds: BrowserBounds | null, feedback: OperationFeedback, page?: WebContents): void {
    if (this.view.webContents.isDestroyed()) return;
    const changed = this.feedback !== feedback;
    this.feedback = feedback;
    this.page = page;
    if (owner !== this.owner) {
      if (this.owner && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(this.view);
      this.owner = owner;
      owner?.contentView.addChildView(this.view);
    }
    if (!owner || !bounds) { this.hide(); return; }
    this.view.setBounds(bounds);
    if (changed) {
      // CDP reports CSS pixels in the guest; the trusted overlay has its own zoom.
      const scale = (page?.getZoomFactor() ?? 1) / this.view.webContents.getZoomFactor();
      this.view.webContents.send("operation:state", feedback.pointer ? {
        ...feedback,
        pointer: { ...feedback.pointer, points: feedback.pointer.points.map(({ x, y }) => ({ x: x * scale, y: y * scale })) },
      } : feedback);
    }
    if (feedback.active) {
      // Reordering is necessary when navigation/popup creation adds a page above us.
      if (owner.contentView.children.at(-1) !== this.view) owner.contentView.addChildView(this.view);
      this.view.setVisible(true);
      if (page?.isFocused()) this.view.webContents.focus();
    }
  }

  private hide(): void {
    const restoreFocus = this.view.webContents.isFocused();
    this.view.setVisible(false);
    if (restoreFocus && this.page && !this.page.isDestroyed()) this.page.focus();
  }

  close(): void {
    if (this.owner && !this.owner.isDestroyed()) this.owner.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  }
}
