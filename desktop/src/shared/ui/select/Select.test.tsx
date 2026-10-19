import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { Select } from "./Select";
import { ConfirmDialog } from "../confirm-dialog";

const options = [{ value: "a", label: "Alpha" }, { value: "b", label: "A much longer model name" }];

test("菜单内部滚动保持打开，页面滚动关闭菜单", async () => {
  render(<Select value="a" options={options} ariaLabel="Model" onChange={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: "Model" }));
  fireEvent.scroll(screen.getByRole("listbox"));
  expect(screen.queryByRole("listbox")).not.toBeNull();
  fireEvent.scroll(window);
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("不可用的选项不能选中，其他选项正常使用", async () => {
  const user = userEvent.setup(), onChange = vi.fn();
  render(<Select value="a" options={[...options, { value: "pending", label: "Pending voice", disabled: true }]} ariaLabel="Voice" onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Voice" }));
  const pending = screen.getByRole("option", { name: "Pending voice" });
  expect(pending).toHaveProperty("disabled", true);
  await user.click(pending);
  expect(onChange).not.toHaveBeenCalled();
  await user.click(screen.getByRole("option", { name: "Alpha" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("a");
});

test("选择选项只触发一次回调，并关闭弹层", async () => {
  const user = userEvent.setup(), onChange = vi.fn();
  render(<Select value="a" options={options} ariaLabel="Model" onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Model" }));
  await user.click(screen.getByRole("option", { name: "A much longer model name" }));
  expect(onChange).toHaveBeenCalledExactlyOnceWith("b");
  expect(screen.queryByRole("listbox")).toBeNull();
});

test("Escape 关闭弹层并返回触发按钮", async () => {
  const user = userEvent.setup();
  render(<Select value="a" options={options} ariaLabel="Model" onChange={() => {}} />);
  const trigger = screen.getByRole("button", { name: "Model" });
  await user.click(trigger);
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

test("打开后被禁用时不能继续操作旧选项", async () => {
  const user = userEvent.setup(), onChange = vi.fn();
  const { rerender } = render(<Select value="a" options={options} ariaLabel="Model" onChange={onChange} />);
  await user.click(screen.getByRole("button", { name: "Model" }));
  rerender(<Select value="a" options={options} ariaLabel="Model" onChange={onChange} disabled />);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.getByRole("button", { name: "Model" })).toHaveProperty("disabled", true);
  expect(onChange).not.toHaveBeenCalled();
});

test("没有模型时按钮不可用，并展示空状态文案", () => {
  render(<Select value="" options={[]} emptyLabel="No models" ariaLabel="Model" onChange={() => {}} />);
  expect(screen.getByRole("button", { name: "Model" })).toHaveProperty("disabled", true);
  expect(screen.getByText("No models")).not.toBeNull();
});

test("先关闭选择框，再处理外层弹窗的 Escape", async () => {
  const user = userEvent.setup(), cancel = vi.fn();
  render(<>
    <ConfirmDialog open title="Confirm" description="Confirm action" onCancel={cancel} onConfirm={() => {}} />
    <Select value="a" options={options} ariaLabel="Model" onChange={() => {}} />
  </>);
  await user.click(screen.getByRole("button", { name: "Model" }));
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(cancel).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");
  expect(cancel).toHaveBeenCalledOnce();
});
