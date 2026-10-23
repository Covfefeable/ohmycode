import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { AndroidInstallPlan } from "@ohmycode/android-use/types";
import { AndroidInstallDialog } from "./AndroidInstallDialog";

const plan: AndroidInstallPlan = { mode: "runtime", root: "/runtime/android", totalBytes: 1250000000, requiredFreeBytes: 15 * 1024 ** 3, licenseUrl: "https://developer.android.com/studio/terms", components: [{ id: "emulator", version: "37.2.12", bytes: 455342868 }, { id: "platformTools", version: "37.0.1", bytes: 8044989 }, { id: "systemImage", version: "35-r02", bytes: 782404023 }] };
const mocks = vi.hoisted(() => ({ install: vi.fn(), openLicense: vi.fn(), toast: vi.fn() }));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));
beforeEach(() => {
  mocks.install.mockReset().mockResolvedValue({ phase: "checking" });
  mocks.openLicense.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { android: mocks } });
});
it("明确展示组件、版本和位置，未同意许可不能下载", async () => {
  const close = vi.fn();
  const choose = vi.fn().mockResolvedValue(undefined);
  render(<AndroidInstallDialog plan={plan} chooseRoot={choose} onClose={close} />);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByText("37.2.12")).toBeTruthy();
  expect(screen.getByText(plan.root)).toBeTruthy();
  const install = screen.getByRole("button", { name: "Install now" });
  expect(install.hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "Change location" }));
  await waitFor(() => expect(choose).toHaveBeenCalledOnce());
  await waitFor(() => expect(screen.getByRole("checkbox").hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(install);
  await waitFor(() => expect(mocks.install).toHaveBeenCalledWith(true, "runtime"));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});
it("许可链接走固定 IPC，点击不开始安装", async () => {
  render(<AndroidInstallDialog plan={plan} chooseRoot={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Android SDK license agreement" }));
  await waitFor(() => expect(mocks.openLicense).toHaveBeenCalledOnce());
  expect(mocks.install).not.toHaveBeenCalled();
});
