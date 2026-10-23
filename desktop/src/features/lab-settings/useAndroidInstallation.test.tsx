import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { AndroidInstallPlan, AndroidInstallState } from "@ohmycode/android-use/types";
import { useAndroidInstallation } from "./useAndroidInstallation";

const idle: AndroidInstallState = { phase: "idle", root: "/android", receivedBytes: 0, totalBytes: 100 };
const plan: AndroidInstallPlan = { root: idle.root, components: [], totalBytes: 100, requiredFreeBytes: 15 * 1024 ** 3, licenseUrl: "https://developer.android.com/studio/terms" };

it("晚到的初始快照不会覆盖安装进度，重新挂载能恢复主进程快照", async () => {
  let listener!: (state: AndroidInstallState) => void;
  let initial!: (state: AndroidInstallState) => void;
  const off = vi.fn();
  const bridge = {
    onInstallation: vi.fn((callback) => { listener = callback; return off; }),
    installation: vi.fn().mockImplementationOnce(() => new Promise<AndroidInstallState>((resolve) => { initial = resolve; })),
    installPlan: vi.fn().mockResolvedValue(plan),
  };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { android: bridge } });
  const { result, unmount } = renderHook(useAndroidInstallation);
  const downloading = { ...idle, phase: "downloading" as const, receivedBytes: 40 };
  act(() => listener(downloading));
  await act(async () => { initial(idle); });
  expect(result.current.state).toEqual(downloading);
  expect(result.current.active).toBe(true);
  unmount();
  expect(off).toHaveBeenCalledOnce();
  bridge.installation.mockResolvedValue(downloading);
  const restored = renderHook(useAndroidInstallation);
  await waitFor(() => expect(restored.result.current.state).toEqual(downloading));
});
