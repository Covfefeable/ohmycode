import { screen, type BrowserWindow } from "electron";

/** Reserve space for the browser without changing the existing conversation width. */
export class BrowserWindowSpace {
  private added = 0;
  private originalX: number | undefined;
  private requested = 0;

  constructor(private readonly window: BrowserWindow) {
    window.on("unmaximize", () => this.reserve(this.requested));
    window.on("leave-full-screen", () => this.reserve(this.requested));
  }

  reserve(width: number): number {
    if (!Number.isFinite(width) || width < 0) throw new Error("browser_invalid_width");
    this.requested = width;
    if (this.window.isMaximized() || this.window.isFullScreen()) {
      // The renderer keeps panel widths and scrolls when the display cannot grow.
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
