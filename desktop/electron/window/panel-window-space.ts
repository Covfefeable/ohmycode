import { screen, type BrowserWindow } from "electron";

/** Reserve space for a side panel without changing the existing conversation width. */
export class PanelWindowSpace {
  private added = 0;
  private originalX: number | undefined;
  private requested = 0;

  constructor(private readonly window: BrowserWindow) {
    window.on("unmaximize", () => this.reserve(this.requested));
    window.on("leave-full-screen", () => this.reserve(this.requested));
  }

  reserve(width: number): number {
    if (!Number.isFinite(width) || width < 0) throw new Error("window_invalid_panel_width");
    this.requested = width;
    if (this.window.isMaximized() || this.window.isFullScreen()) {
      // The renderer fits both panels into the available width when the display cannot grow.
      return this.window.getContentSize()[0] - this.added;
    }
    const bounds = this.window.getBounds();
    const baseWidth = bounds.width - this.added;
    const area = screen.getDisplayMatching(bounds).workArea;
    const nextWidth = Math.min(area.width, baseWidth + Math.round(width));
    const x = width === 0 && this.originalX !== undefined
      ? Math.max(area.x, Math.min(this.originalX, area.x + area.width - nextWidth))
      : Math.max(area.x, Math.min(bounds.x, area.x + area.width - nextWidth));
    if (this.originalX === undefined && width > 0) this.originalX = bounds.x;
    this.added = Math.max(0, nextWidth - baseWidth);
    this.window.setBounds({ ...bounds, x, width: nextWidth });
    if (width === 0) this.originalX = undefined;
    return this.window.getContentSize()[0] - this.added;
  }
}

const spaces = new Map<number, PanelWindowSpace>();
export function reservePanelSpace(window: BrowserWindow, width: number): number {
  let space = spaces.get(window.id);
  if (!space) {
    space = new PanelWindowSpace(window);
    spaces.set(window.id, space);
    window.once("closed", () => spaces.delete(window.id));
  }
  return space.reserve(width);
}
