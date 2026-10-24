import { render, screen } from "@testing-library/react";
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
