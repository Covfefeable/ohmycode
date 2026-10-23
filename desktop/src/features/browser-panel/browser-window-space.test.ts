import { beforeEach, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { PanelWindowSpace } from "../../../electron/window/panel-window-space";

const { display } = vi.hoisted(() => ({ display: vi.fn() }));
vi.mock("electron", () => ({ screen: { getDisplayMatching: display } }));

beforeEach(() => display.mockReturnValue({ workArea: { x: 0, y: 0, width: 2400, height: 1400 } }));

function fixture() {
  let bounds = { x: 200, y: 100, width: 1380, height: 880 };
  const window = {
    on: vi.fn(),
    isMaximized: vi.fn(() => false), isFullScreen: vi.fn(() => false),
    getBounds: () => bounds,
    getContentSize: () => [bounds.width, bounds.height],
    setBounds: vi.fn((next: typeof bounds) => { bounds = next; }),
  };
  return { window, space: new PanelWindowSpace(window as unknown as BrowserWindow) };
}

it("adds browser width instead of consuming conversation space and restores on close", () => {
  const { window, space } = fixture();
  expect(space.reserve(600)).toBe(1380);
  expect(window.getBounds()).toEqual({ x: 200, y: 100, width: 1980, height: 880 });
  space.reserve(720);
  expect(window.getBounds().width).toBe(2100);
  space.reserve(0);
  expect(window.getBounds()).toEqual({ x: 200, y: 100, width: 1380, height: 880 });
});

it("fits the current display including negative coordinates without shrinking the base", () => {
  display.mockReturnValue({ workArea: { x: -1920, y: 0, width: 1920, height: 1080 } });
  const { window, space } = fixture();
  window.setBounds({ x: -1500, y: 100, width: 1380, height: 880 });
  expect(space.reserve(800)).toBe(1380);
  expect(window.getBounds()).toEqual({ x: -1920, y: 100, width: 1920, height: 880 });
  space.reserve(0);
  expect(window.getBounds().x).toBe(-1500);
});

it("does not unmaximize or resize a fullscreen window", () => {
  const { window, space } = fixture();
  window.isMaximized.mockReturnValue(true);
  space.reserve(600);
  expect(window.setBounds).not.toHaveBeenCalled();
  window.isMaximized.mockReturnValue(false);
  window.isFullScreen.mockReturnValue(true);
  space.reserve(0);
  expect(window.setBounds).not.toHaveBeenCalled();
});

it("removes reserved width after restoring a window that was closed while maximized", () => {
  const { window, space } = fixture();
  space.reserve(600);
  window.isMaximized.mockReturnValue(true);
  space.reserve(0);
  window.isMaximized.mockReturnValue(false);
  const restore = window.on.mock.calls.find(([event]) => event === "unmaximize")![1] as () => void;
  restore();
  expect(window.getBounds().width).toBe(1380);
});
