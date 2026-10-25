import { expect, it } from "vitest";
import { ScreenshotCoordinates } from "../../../packages/android-use/src/coordinates";

const screen = { width: 1080, height: 2400, rotation: 0 };

it("分别按实际横纵尺寸转换截图像素和归一化坐标，不猜单位", () => {
  const coordinates = new ScreenshotCoordinates();
  const reference = coordinates.capture(503, 1119, screen);
  const image = coordinates.resolve({ action: "swipe", screenshotId: reference.screenshotId, coordinateSpace: "image-pixels", x: 251.5, y: 559.5, endX: 0, endY: 1118 }, screen);
  expect(image.command).toMatchObject({ x: 540, y: 1200, endX: 0, endY: 2398 });
  expect(image.coordinates).toMatchObject({ screenshotId: reference.screenshotId, image: { width: 503, height: 1119 }, screen, points: [{ x: 540, y: 1200 }, { x: 0, y: 2398 }] });
  expect(coordinates.resolve({ action: "tap", screenshotId: reference.screenshotId, coordinateSpace: "normalized-1000", x: 500, y: 1000 }, screen).command).toMatchObject({ x: 540, y: 2399 });
  expect(() => coordinates.resolve({ screenshotId: reference.screenshotId, x: 1, y: 2 }, screen)).toThrow("android_invalid_coordinate_space");
  for (const [x, y] of [[-1, 0], [503, 0], [0, 1119], [NaN, 0], [Infinity, 0]]) {
    expect(() => coordinates.resolve({ screenshotId: reference.screenshotId, coordinateSpace: "image-pixels", x, y }, screen)).toThrow("android_invalid_coordinates");
  }
  expect(() => coordinates.resolve({ screenshotId: reference.screenshotId, coordinateSpace: "normalized-1000", x: 1001, y: 0 }, screen)).toThrow("android_invalid_coordinates");
});

it("新截图、人工失效和屏幕几何改变都拒绝旧坐标", () => {
  const coordinates = new ScreenshotCoordinates();
  const first = coordinates.capture(1080, 2400, screen);
  const second = coordinates.capture(1080, 2400, screen);
  const args = { action: "tap", screenshotId: second.screenshotId, coordinateSpace: "image-pixels", x: 100, y: 200 };
  expect(() => coordinates.resolve({ ...args, screenshotId: first.screenshotId }, screen)).toThrow("android_screenshot_expired");
  expect(() => coordinates.resolve(args, { ...screen, rotation: 2 })).toThrow("android_layout_changed");
  expect(() => coordinates.resolve(args, screen)).toThrow("android_screenshot_expired");
  const third = coordinates.capture(1080, 2400, screen);
  expect(() => coordinates.resolve({ ...args, screenshotId: third.screenshotId }, { ...screen, height: 2300 })).toThrow("android_layout_changed");
  const fourth = coordinates.capture(1080, 2400, screen);
  coordinates.invalidate();
  expect(() => coordinates.resolve({ ...args, screenshotId: fourth.screenshotId }, screen)).toThrow("android_screenshot_expired");
});
