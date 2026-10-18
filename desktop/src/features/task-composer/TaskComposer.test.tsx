import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { TaskComposer } from "./TaskComposer";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
vi.mock("../../shared/ui/prompt-editor", () => ({
  usePromptCapabilities: () => [],
  PromptEditor: ({ value, onChange, disabled, ariaLabel }: { value: string; onChange(value: string): void; disabled: boolean; ariaLabel: string }) => <textarea aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
}));

const props = { models: [{ id: "model", name: "Test", model: "test" }] as ModelConfiguration[], selectedModelId: "model", onModelChange() {}, onStop: vi.fn(), onSubmit: vi.fn(async () => true) };

test("运行中可以继续输入并发送，停止按钮独立保留", async () => {
  const user = userEvent.setup(), onSubmit = vi.fn(async () => true), onStop = vi.fn();
  render(<TaskComposer {...props} busy onSubmit={onSubmit} onStop={onStop} />);
  const editor = screen.getByRole("textbox");
  expect((editor as HTMLTextAreaElement).disabled).toBe(false);
  await user.type(editor, "Queue this");
  await user.click(screen.getByRole("button", { name: "Run ↵" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Queue this", []);
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(""));
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalledOnce();
});

test("发送失败保留草稿；撤销消息追加到现有草稿，不覆盖", async () => {
  const user = userEvent.setup(), onSubmit = vi.fn(async () => false);
  const { rerender } = render(<TaskComposer {...props} onSubmit={onSubmit} />);
  const editor = screen.getByRole("textbox") as HTMLTextAreaElement;
  await user.type(editor, "Existing");
  await user.click(screen.getByRole("button", { name: "Run ↵" }));
  await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
  expect(editor.value).toBe("Existing");
  rerender(<TaskComposer {...props} restoredInput={{ id: "one", content: "Withdrawn", attachments: [], status: "queued" }} />);
  expect(editor.value).toBe("Existing\n\nWithdrawn");
  fireEvent.change(editor, { target: { value: "Still here" } });
  rerender(<TaskComposer {...props} restoredInput={{ id: "one", content: "Withdrawn", attachments: [], status: "queued" }} />);
  expect(editor.value).toBe("Still here");
});
