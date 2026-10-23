import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AndroidInstallCard } from "./AndroidInstallCard";

const toast = vi.hoisted(() => vi.fn());
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast }) }));
it("下载状态展示实际进度和取消，收尾阶段禁止中断配置", async () => {
  const cancelInstall = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { android: { cancelInstall } } });
  const installation = { state: { phase: "downloading" as const, root: "/android", receivedBytes: 40, totalBytes: 100, component: "emulator" as const }, plan: null, active: true, failed: false, retry: vi.fn(), chooseRoot: vi.fn() };
  const view = render(<AndroidInstallCard installation={installation} />);
  expect(screen.getByRole("progressbar").getAttribute("value")).toBe("40");
  expect(screen.getByText("Downloading")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Cancel installation" }));
  await waitFor(() => expect(cancelInstall).toHaveBeenCalledOnce());
  view.rerender(<AndroidInstallCard installation={{ ...installation, state: { ...installation.state, phase: "finishing" } }} />);
  expect(screen.getByRole("button", { name: "Cancel installation" }).hasAttribute("disabled")).toBe(true);
});
