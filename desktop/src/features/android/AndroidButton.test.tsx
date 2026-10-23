import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AndroidButton } from "./AndroidButton";
import type { AndroidState } from "@ohmycode/android-use/types";

const ready: AndroidState = { enabled: true, installed: true, sdkPath: "/sdk", phase: "stopped" };
it.each([null, { ...ready, installed: false }, { ...ready, enabled: false }])("未完成安装或停用时不显示入口", (state) => {
  render(<AndroidButton state={state} opened={false} onToggle={vi.fn()} />);
  expect(screen.queryByRole("button")).toBeNull();
});
it("环境可用才显示共享图标按钮，包含 tooltip 和选中态", () => {
  const toggle = vi.fn();
  render(<AndroidButton state={ready} opened onToggle={toggle} />);
  const button = screen.getByRole("button", { name: "Android" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(button);
  expect(toggle).toHaveBeenCalledOnce();
});
