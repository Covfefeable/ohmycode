import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { IconButton } from "./IconButton";

test("表单内的普通图标按钮不会误提交表单", async () => {
  const user = userEvent.setup(), submit = vi.fn((event) => event.preventDefault());
  render(<form onSubmit={submit}><IconButton aria-label="Delete" /></form>);
  await user.click(screen.getByRole("button", { name: "Delete" }));
  expect(submit).not.toHaveBeenCalled();
});

test("调用者可以显式指定提交按钮", async () => {
  const user = userEvent.setup(), submit = vi.fn((event) => event.preventDefault());
  render(<form onSubmit={submit}><IconButton type="submit" aria-label="Send" /></form>);
  await user.click(screen.getByRole("button", { name: "Send" }));
  expect(submit).toHaveBeenCalledOnce();
});
