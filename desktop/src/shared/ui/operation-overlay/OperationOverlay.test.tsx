import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OperationOverlay } from "./OperationOverlay";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe() { this.callback([{ contentRect: { width: 640, height: 360 } } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    disconnect() {}
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it("安卓标记按设备屏幕坐标映射，不使用缩小后的视频分辨率", () => {
  const view = render(<OperationOverlay feedback={{ active: true, pointer: { id: 1, points: [{ x: 960, y: 540 }], durationMs: 300, size: { width: 1920, height: 1080 } } }} />);
  const dot = view.container.querySelector("circle")!;
  expect(dot.getAttribute("cx")).toBe("320");
  expect(dot.getAttribute("cy")).toBe("180");
});

it("瞬时操作保留展示，连续操作延长展示，淡出完成才通知原生视图隐藏", () => {
  const hidden = vi.fn();
  const view = render(<OperationOverlay feedback={{ active: true }} onHidden={hidden} />);
  const layer = view.container.firstElementChild!;
  expect(view.getByRole("status").textContent).toBe("Agent is operating");
  view.rerender(<OperationOverlay feedback={{ active: false }} onHidden={hidden} />);
  act(() => vi.advanceTimersByTime(400));
  expect(layer.getAttribute("data-active")).toBe("true");
  expect(layer.getAttribute("data-blocked")).toBe("false");
  view.rerender(<OperationOverlay feedback={{ active: true }} onHidden={hidden} />);
  act(() => vi.advanceTimersByTime(400));
  expect(hidden).not.toHaveBeenCalled();
  view.rerender(<OperationOverlay feedback={{ active: false }} onHidden={hidden} />);
  act(() => vi.advanceTimersByTime(1000));
  expect(layer.getAttribute("data-active")).toBe("true");
  act(() => vi.advanceTimersByTime(200));
  expect(layer.getAttribute("data-active")).toBe("false");
  expect(view.queryByRole("status")).toBeNull();
  expect(hidden).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(180));
  expect(hidden).toHaveBeenCalledOnce();
});
