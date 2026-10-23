import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { LabSettings } from "./LabSettings";
import type { AndroidState } from "@ohmycode/android-use/types";
import userEvent from "@testing-library/user-event";

const removeDevice = vi.hoisted(() => vi.fn());

const mocks = vi.hoisted(() => ({ state: { enabled: false, installed: false, sdkPath: "", phase: "stopped", issue: "sdk_missing", target: { kind: "managed" }, devices: [], adbReady: false, managedInstalled: false } as AndroidState, toast: vi.fn(), chooseSdk: vi.fn(), setEnabled: vi.fn(), selectTarget: vi.fn(), refresh: vi.fn(), start: vi.fn(), stop: vi.fn(), openGuide: vi.fn() }));
vi.mock("../android/useAndroidState", () => ({ useAndroidState: () => ({ state: mocks.state, failed: false, retry: vi.fn() }) }));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));
vi.mock("./useAndroidInstallation", () => ({ useAndroidInstallation: () => ({ state: null, plan: null, active: false, failed: false, retry: vi.fn(), chooseRoot: vi.fn() }) }));
beforeEach(() => {
  mocks.state = { enabled: false, installed: false, sdkPath: "", phase: "stopped", issue: "sdk_missing", target: { kind: "managed" }, devices: [], adbReady: false, managedInstalled: false };
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { android: { ...mocks, removeDevice } } });
  mocks.chooseSdk.mockReset().mockResolvedValue(undefined);
  mocks.setEnabled.mockReset().mockResolvedValue(undefined);
  mocks.refresh.mockReset().mockResolvedValue(undefined);
  removeDevice.mockReset().mockResolvedValue(undefined);
});

it("图标提示显示后第一次点击就生效，移除设备需要确认", async () => {
  const user = userEvent.setup();
  mocks.state = { ...mocks.state, adbReady: true, devices: [{ serial: "phone", name: "Pixel", status: "device", transport: "usb" }] };
  render(<LabSettings />);
  const refresh = screen.getByRole("button", { name: "Refresh devices" });
  await user.hover(refresh);
  expect(screen.getByRole("tooltip").textContent).toBe("Refresh devices");
  await user.click(refresh);
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  await user.click(screen.getByRole("button", { name: "Remove device" }));
  expect(removeDevice).not.toHaveBeenCalled();
  const dialog = screen.getByRole("alertdialog");
  await user.click(dialog.querySelector("footer button:last-child")!);
  await waitFor(() => expect(removeDevice).toHaveBeenCalledWith("phone"));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  await user.click(screen.getByRole("button", { name: "Configure ADB" }));
  expect(screen.getByRole("button", { name: "Next" })).toBeTruthy();
});
it("无 SDK 也能配置接入，不在设置里启动模拟器", async () => {
  const view = render(<LabSettings />);
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(false);
  expect(screen.getByText("Install ADB or choose an existing folder")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Choose SDK folder" }));
  await waitFor(() => expect(mocks.chooseSdk).toHaveBeenCalledOnce());
  expect(screen.getByRole("button", { name: "Next" }).hasAttribute("disabled")).toBe(true);
  expect(screen.queryByText("Built-in emulator")).toBeNull();
  mocks.state = { ...mocks.state, adbReady: true, sdkPath: "/sdk" };
  view.rerender(<LabSettings />);
  expect(screen.queryByText("Built-in emulator")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Built-in emulator")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Install now" })).toBeTruthy();
  expect(mocks.start).not.toHaveBeenCalled();
});
it("环境检查通过后用户才可启用", async () => {
  mocks.state = { ...mocks.state, installed: true, sdkPath: "/sdk", adbReady: true, managedInstalled: true, issue: undefined };
  render(<LabSettings />);
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(mocks.setEnabled).toHaveBeenCalledWith(true));
});
it("运行时不能更换目录或停用，实验室不提供启动停止操作", () => {
  mocks.state = { ...mocks.state, enabled: true, installed: true, sdkPath: "/sdk", phase: "running", issue: undefined, adbReady: true, managedInstalled: true };
  render(<LabSettings />);
  expect(screen.getByRole("button", { name: "Configure ADB" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(true);
  expect(screen.queryByRole("button", { name: "Stop emulator" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Start emulator" })).toBeNull();
});

it("只有设置页选择操作会改变目标，未授权设备不可选择，选择不启动设备", async () => {
  mocks.state = { ...mocks.state, enabled: true, adbReady: true, devices: [
    { serial: "phone", name: "Pixel", status: "device", transport: "usb" },
    { serial: "unauthorized", name: "Other phone", status: "unauthorized", transport: "usb" },
  ] };
  mocks.selectTarget.mockResolvedValue(undefined);
  render(<LabSettings />);
  const buttons = screen.getAllByRole("button", { name: "Select" });
  expect(buttons[1].hasAttribute("disabled")).toBe(true);
  fireEvent.click(buttons[0]);
  await waitFor(() => expect(mocks.selectTarget).toHaveBeenCalledWith({ kind: "external", serial: "phone", name: "Pixel" }));
  expect(mocks.start).not.toHaveBeenCalled();
});
