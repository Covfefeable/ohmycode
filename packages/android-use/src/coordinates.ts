import { randomUUID } from "node:crypto";

export type ScreenGeometry = { width: number; height: number; rotation: number };
export type ScreenshotReference = {
  screenshotId: string;
  width: number;
  height: number;
  screen: ScreenGeometry;
};
export type CoordinateSpace = "image-pixels" | "normalized-1000";

/** One current observation, owned by the connected device session. */
export class ScreenshotCoordinates {
  private latest?: ScreenshotReference;

  capture(width: number, height: number, screen: ScreenGeometry): ScreenshotReference {
    const reference = { screenshotId: randomUUID(), width, height, screen: { ...screen } };
    this.latest = reference;
    return reference;
  }

  invalidate(): void { this.latest = undefined; }

  resolve(args: Record<string, unknown>, screen: ScreenGeometry) {
    const reference = this.latest;
    if (!reference || args.screenshotId !== reference.screenshotId) throw new Error("android_screenshot_expired");
    if (screen.width !== reference.screen.width || screen.height !== reference.screen.height || screen.rotation !== reference.screen.rotation) {
      this.invalidate();
      throw new Error("android_layout_changed");
    }
    const space = args.coordinateSpace;
    if (space !== "image-pixels" && space !== "normalized-1000") throw new Error("android_invalid_coordinate_space");
    const convert = (value: unknown, imageExtent: number, screenExtent: number): number => {
      const extent = space === "normalized-1000" ? 1000 : imageExtent;
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || (space === "image-pixels" ? value >= extent : value > extent)) throw new Error("android_invalid_coordinates");
      return Math.min(screenExtent - 1, Math.round(value / extent * screenExtent));
    };
    const point = (x: unknown, y: unknown) => ({ x: convert(x, reference.width, screen.width), y: convert(y, reference.height, screen.height) });
    const start = point(args.x, args.y);
    const end = args.action === "swipe" ? point(args.endX, args.endY) : undefined;
    return {
      command: { ...args, ...start, ...(end ? { endX: end.x, endY: end.y } : {}) },
      coordinates: {
        screenshotId: reference.screenshotId, coordinateSpace: space,
        image: { width: reference.width, height: reference.height }, screen,
        points: end ? [start, end] : [start],
      },
    };
  }
}
