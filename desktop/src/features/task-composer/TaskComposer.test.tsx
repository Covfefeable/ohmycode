import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { TaskComposer } from "./TaskComposer";
const microphone = vi.hoisted(() => ({ state: "idle", active: false, toggle: vi.fn(), finish: vi.fn() }));
vi.mock("../speech/useSpeechInput", () => ({ useSpeechInput: () => microphone }));
vi.mock("../speech/speech-context", () => ({ useSpeech: () => ({ settings: { autoPlay: false } }) }));
beforeEach(() => { microphone.state = "idle"; microphone.active = false; microphone.finish.mockReset(); });

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
vi.mock("../../shared/ui/prompt-editor", () => ({
  usePromptCapabilities: () => [],
  PromptEditor: ({ value, onChange, disabled, ariaLabel }: { value: string; onChange(value: string): void; disabled: boolean; ariaLabel: string }) => <textarea aria-label={ariaLabel} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />,
}));

const props = { models: [{ id: "model", name: "Test", model: "test" }] as ModelConfiguration[], selectedModelId: "model", onModelChange() {}, onStop: vi.fn(), onSubmit: vi.fn(async () => true) };

test("录音时可直接点击发送，等识别收尾后只提交一次", async () => {
  microphone.state = "recording";
  microphone.active = true;
  let finish!: (text: string | null) => void;
  microphone.finish.mockReturnValue(new Promise<string | null>((resolve) => { finish = resolve; }));
  const onSubmit = vi.fn(async () => true);
  render(<TaskComposer {...props} onSubmit={onSubmit} />);
  const send = screen.getByRole("button", { name: "Run ↵" }) as HTMLButtonElement;
  expect(send.disabled).toBe(false);
  await userEvent.click(send);
  expect(microphone.finish).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(send.disabled).toBe(true);
  await act(async () => finish("最终识别结果"));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("最终识别结果", []);
});

test("识别失败不发送已有半句，恢复发送按钮", async () => {
  microphone.state = "recording";
  microphone.active = true;
  microphone.finish.mockResolvedValue(null);
  const onSubmit = vi.fn();
  render(<TaskComposer {...props} onSubmit={onSubmit} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "半句" } });
  await userEvent.click(screen.getByRole("button", { name: "Run ↵" }));
  expect(onSubmit).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("半句");
});

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

test("粘贴图片转交附件流程，保存期间禁止发送，普通文本粘贴不受影响", async () => {
  let finish: () => void = () => {};
  const onPasteImages = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<TaskComposer {...props} onPasteImages={onPasteImages} />);
  const editor = screen.getByRole("textbox");
  fireEvent.change(editor, { target: { value: "Draft" } });
  const image = new File(["png"], "clipboard.png", { type: "image/png" });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { files: [image] } });
  fireEvent(editor, event);
  expect(event.defaultPrevented).toBe(true);
  expect(onPasteImages).toHaveBeenCalledExactlyOnceWith([image]);
  expect((screen.getByRole("button", { name: "Run ↵" }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish());
  expect((screen.getByRole("button", { name: "Run ↵" }) as HTMLButtonElement).disabled).toBe(false);
  const text = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(text, "clipboardData", { value: { files: [] } });
  fireEvent(editor, text);
  expect(text.defaultPrevented).toBe(false);
  expect((editor as HTMLTextAreaElement).value).toBe("Draft");
});
