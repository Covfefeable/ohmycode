import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LabSettings } from "./LabSettings";

const mocks = vi.hoisted(() => ({ state: { enabled: false, installed: false, sdkPath: "", phase: "stopped", issue: "sdk_missing" }, toast: vi.fn(), chooseSdk: vi.fn(), setEnabled: vi.fn(), refresh: vi.fn(), start: vi.fn(), stop: vi.fn(), openGuide: vi.fn() }));
vi.mock("../android/useAndroidState", () => ({ useAndroidState: () => ({ state: mocks.state, failed: false, retry: vi.fn() }) }));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));
vi.mock("./useAndroidInstallation", () => ({ useAndroidInstallation: () => ({ state: null, plan: null, active: false, failed: false, retry: vi.fn(), chooseRoot: vi.fn() }) }));
beforeEach(() => {
  mocks.state = { enabled: false, installed: false, sdkPath: "", phase: "stopped", issue: "sdk_missing" };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { android: mocks } });
  mocks.chooseSdk.mockReset().mockResolvedValue(undefined);
  mocks.setEnabled.mockReset().mockResolvedValue(undefined);
});
it("无 SDK 时显示说明和本机目录选择，不允许启用", async () => {
  render(<LabSettings />);
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  expect(screen.getByText(/Android SDK not found/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Choose SDK folder" }));
  await waitFor(() => expect(mocks.chooseSdk).toHaveBeenCalledOnce());
  expect(mocks.start).not.toHaveBeenCalled();
});
it("环境检查通过后用户才可启用", async () => {
  mocks.state = { enabled: false, installed: true, sdkPath: "/sdk", phase: "stopped", issue: "" };
  render(<LabSettings />);
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(true));
});
it("运行时不能更换目录或停用，实验室不提供启动停止操作", () => {
  mocks.state = { enabled: true, installed: true, sdkPath: "/sdk", phase: "running", issue: "" };
  render(<LabSettings />);
  expect(screen.getByRole("button", { name: "Choose SDK folder" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Stop emulator" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start emulator" })).toBeNull();
});
