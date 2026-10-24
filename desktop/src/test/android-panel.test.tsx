import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AndroidState } from "@ohmycode/android-use/types";
import { AndroidPanel } from "../features/android/AndroidPanel";
import type { useAndroidVideo } from "../features/android/useAndroidVideo";

const video = vi.hoisted(() => vi.fn<typeof useAndroidVideo>(() => ({ size: { width: 720, height: 1280 }, error: undefined })));
vi.mock("../features/android/useAndroidVideo", () => ({ useAndroidVideo: video }));
vi.mock("../features/android/useAndroidPresentation", () => ({ useAndroidPresentation: () => false }));
vi.mock("../shared/hooks/useSidePanelResize", () => ({ useSidePanelResize: () => ({ width: 400 }) }));

it("切换到被占用的会话立即隐藏画面并禁用订阅和控制，释放后恢复连接入口", () => {
  const state: AndroidState = { phase: "running", ownerConversationId: "owner", enabled: true, installed: true, sdkPath: "/sdk", adbReady: true, managedInstalled: false, target: { kind: "external", serial: "phone", name: "Phone" }, devices: [] };
  const props = { state, active: true, onClose: vi.fn(), conversationId: "owner" };
  const view = render(<AndroidPanel {...props} />);
  expect(screen.getByLabelText(/^Android screen:/)).not.toBeNull();
  view.rerender(<AndroidPanel {...props} conversationId="other" />);
  expect(screen.queryByLabelText(/^Android screen:/)).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("Another conversation is using this device");
  expect(video.mock.lastCall?.[2]).toBe(false);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Back" }).disabled).toBe(true);
  view.rerender(<AndroidPanel {...props} conversationId="other" state={{ ...state, phase: "stopped", ownerConversationId: undefined }} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "Connect" }).disabled).toBe(false);
});

it("离线后重试重新连接当前设备，连接恢复后清除旧错误并订阅画面", async () => {
  let resolveStart!: () => void;
  const start = vi.fn(() => new Promise<void>((resolve) => { resolveStart = resolve; }));
  const bridge = window.ohmycode;
  window.ohmycode = { android: { start } } as unknown as typeof bridge;
  try {
    const state: AndroidState = { phase: "error", error: "android_device_offline", enabled: true, installed: true, sdkPath: "/sdk", adbReady: true, managedInstalled: false, target: { kind: "external", serial: "phone", name: "Phone" }, devices: [] };
    const props = { state, active: true, onClose: vi.fn(), conversationId: "owner" };
    const view = render(<AndroidPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(start).toHaveBeenCalledExactlyOnceWith("owner");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Retry" }).disabled).toBe(true);
    resolveStart();
    view.rerender(<AndroidPanel {...props} state={{ ...state, phase: "running", error: undefined, ownerConversationId: "owner" }} />);
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
    expect(screen.getByLabelText(/^Android screen:/)).not.toBeNull();
    expect(video.mock.lastCall?.[2]).toBe(true);
  } finally { window.ohmycode = bridge; }
});
