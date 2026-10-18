import { createRef } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { ConversationSearchBar } from "./ConversationSearchBar";

test("查找键盘操作与输入法互不干扰，计数明确显示匹配消息", () => {
  const onMove = vi.fn(), onClose = vi.fn();
  render(<ConversationSearchBar inputRef={createRef()} query="word" result={{ messageId: "one", position: 2, total: 5 }} loading={false} failed={false} onChange={vi.fn()} onMove={onMove} onClose={onClose} onRetry={vi.fn()} />);
  expect(screen.getByRole("status").textContent).toBe("2 / 5");
  const input = screen.getByRole("textbox");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onMove).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(onMove.mock.calls).toEqual([["next"], ["previous"]]);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(onClose).toHaveBeenCalledOnce();
});
