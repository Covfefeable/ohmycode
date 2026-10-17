import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ConfirmDialog } from "./ConfirmDialog";

test("确认与取消分别触发正确动作", async () => {
  const user = userEvent.setup(), onCancel = vi.fn(), onConfirm = vi.fn();
  render(<ConfirmDialog open title="Delete project" description="Cannot undo" onCancel={onCancel} onConfirm={onConfirm} />);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(onConfirm).toHaveBeenCalledOnce();
  expect(onCancel).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(onCancel).toHaveBeenCalledOnce();
});

test("处理中不会被 Escape 或按钮重复提交、取消", async () => {
  const user = userEvent.setup(), onCancel = vi.fn(), onConfirm = vi.fn();
  render(<ConfirmDialog open busy title="Delete project" description="Cannot undo" onCancel={onCancel} onConfirm={onConfirm} />);
  await user.keyboard("{Escape}");
  await user.click(screen.getByRole("button", { name: "Delete" }));
  await user.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).not.toHaveBeenCalled();
});
