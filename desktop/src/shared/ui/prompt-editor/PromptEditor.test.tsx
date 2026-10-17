import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";

test("Enter 提交，Shift+Enter 和输入法确认不提交", () => {
  const onSubmit = vi.fn();
  render(<PromptEditor value="Hi" onChange={() => {}} ariaLabel="Message" submitOnEnter onSubmit={onSubmit} />);
  const editor = screen.getByRole("textbox", { name: "Message" });
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 13, shiftKey: true });
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 13, isComposing: true });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 13 });
  expect(onSubmit).toHaveBeenCalledOnce();
});

test("外部清空编辑器不会回写旧内容，禁用状态正确同步", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<PromptEditor value="Draft" onChange={onChange} ariaLabel="Message" />);
  const editor = screen.getByRole("textbox", { name: "Message" });
  await waitFor(() => expect(editor.textContent).toBe("Draft"));
  onChange.mockClear();
  rerender(<PromptEditor value="" disabled onChange={onChange} ariaLabel="Message" />);
  await waitFor(() => expect(editor.textContent).toBe(""));
  expect(editor.getAttribute("contenteditable")).toBe("false");
  expect(onChange).not.toHaveBeenCalled();
});
