import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { $getRoot, getNearestEditorFromDOMNode, type TextNode } from "lexical";
import { expect, test, vi } from "vitest";
import { PromptEditor } from "./PromptEditor";

test("Enter 提交，Shift+Enter 和输入法确认不提交", () => {
  const onSubmit = vi.fn();
  render(<PromptEditor value="Hi" onChange={() => {}} ariaLabel="Message" submitOnEnter onSubmit={onSubmit} />);
  const editor = screen.getByRole("textbox", { name: "Message" });
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 13, shiftKey: true });
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 13, isComposing: true });
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 229 });
  expect(onSubmit).not.toHaveBeenCalled();
  fireEvent.keyDown(editor, { key: "Enter", keyCode: 13 });
  expect(onSubmit).toHaveBeenCalledOnce();
});

test("流式父组件重渲染不重建本地组词内容，保留原文字节点", async () => {
  const onChange = vi.fn();
  const { rerender } = render(<PromptEditor value="Draft" options={[]} onChange={onChange} ariaLabel="Message" />);
  const element = screen.getByRole("textbox", { name: "Message" });
  const editor = getNearestEditorFromDOMNode(element)!;
  const composing = vi.spyOn(editor, "isComposing").mockReturnValue(true);
  onChange.mockClear();
  act(() => editor.update(() => { $getRoot().getFirstDescendant<TextNode>()!.setTextContent("正在组词pinyin"); }, { discrete: true }));
  const textNode = element.querySelector("[data-lexical-text]");
  for (let index = 0; index < 4; index++) {
    rerender(<PromptEditor value="Draft" options={[]} onChange={onChange} ariaLabel="Message" />);
  }
  await waitFor(() => expect(element.textContent).toBe("正在组词pinyin"));
  expect(element.querySelector("[data-lexical-text]")).toBe(textNode);
  expect(onChange).not.toHaveBeenCalled();
  composing.mockReturnValue(false);
  act(() => editor.update(() => { $getRoot().getFirstDescendant<TextNode>()!.setTextContent("正在组词拼音"); }, { discrete: true }));
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith("正在组词拼音"));
});

test("Lexical 仍处于组词状态时，回车不能提交消息", () => {
  const onSubmit = vi.fn();
  render(<PromptEditor value="Draft" onChange={() => {}} ariaLabel="Message" submitOnEnter onSubmit={onSubmit} />);
  const element = screen.getByRole("textbox", { name: "Message" });
  vi.spyOn(getNearestEditorFromDOMNode(element)!, "isComposing").mockReturnValue(true);
  fireEvent.keyDown(element, { key: "Enter", keyCode: 13 });
  expect(onSubmit).not.toHaveBeenCalled();
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
