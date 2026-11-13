import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";
import { TaskComposer } from "./TaskComposer";
const microphone = vi.hoisted(() => ({ state: "idle", active: false, toggle: vi.fn(), finish: vi.fn(), change: vi.fn<(text: string) => void>() }));
vi.mock("../speech/useSpeechInput", () => ({ useSpeechInput: (_content: string, onChange: (text: string) => void) => { microphone.change.mockImplementation(onChange); return microphone; } }));
vi.mock("../speech/speech-context", () => ({ useSpeech: () => ({ settings: { autoPlay: false } }) }));
beforeEach(() => { microphone.state = "idle"; microphone.active = false; microphone.finish.mockReset(); microphone.toggle.mockReset(); });

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
  act(() => microphone.change("识别中的文字"));
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

test("运行中空输入显示停止，有草稿切换为发送，发送后恢复停止", async () => {
  const user = userEvent.setup(), onSubmit = vi.fn(async () => true), onStop = vi.fn();
  render(<TaskComposer {...props} busy onSubmit={onSubmit} onStop={onStop} />);
  const editor = screen.getByRole("textbox");
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
  expect((editor as HTMLTextAreaElement).disabled).toBe(false);
  await user.type(editor, "Queue this");
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  await user.click(screen.getByRole("button", { name: "Run ↵" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("Queue this", []);
  await waitFor(() => expect((editor as HTMLTextAreaElement).value).toBe(""));
  await user.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalledOnce();
});

test("空闲录音没有识别内容时不能发送，麦克风保持独立控制", async () => {
  microphone.state = "recording";
  microphone.active = true;
  const onSubmit = vi.fn(), onStop = vi.fn();
  render(<TaskComposer {...props} onSubmit={onSubmit} onStop={onStop} />);
  expect(screen.getByRole("button", { name: "Run ↵" }).hasAttribute("disabled")).toBe(true);
  const mic = screen.getByRole("button", { name: "Finish voice input" });
  expect(mic.getAttribute("aria-pressed")).toBe("true");
  expect(mic.querySelector("svg")?.classList.contains("lucide-mic")).toBe(true);
  await userEvent.click(mic);
  expect(microphone.toggle).toHaveBeenCalledOnce();
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});

test("运行中录音没有文字时停止 Agent，不结束录音；只有空白也视为空", async () => {
  microphone.state = "recording";
  microphone.active = true;
  const onStop = vi.fn(async () => {}), onSubmit = vi.fn();
  render(<TaskComposer {...props} busy onStop={onStop} onSubmit={onSubmit} />);
  act(() => microphone.change("  \n "));
  await userEvent.click(screen.getByRole("button", { name: "Stop" }));
  expect(onStop).toHaveBeenCalledOnce();
  expect(microphone.finish).not.toHaveBeenCalled();
  expect(microphone.toggle).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Finish voice input" }).getAttribute("aria-pressed")).toBe("true");
  expect(onSubmit).not.toHaveBeenCalled();
});

test("运行中已有语音文字时发送会等待最终结果，空结果不会转为停止", async () => {
  microphone.state = "recording";
  microphone.active = true;
  let finish!: (text: string | null) => void;
  microphone.finish.mockReturnValue(new Promise<string | null>((resolve) => { finish = resolve; }));
  const onStop = vi.fn(), onSubmit = vi.fn();
  render(<TaskComposer {...props} busy onStop={onStop} onSubmit={onSubmit} />);
  act(() => microphone.change("临时识别文字"));
  await userEvent.click(screen.getByRole("button", { name: "Run ↵" }));
  expect(microphone.finish).toHaveBeenCalledOnce();
  act(() => microphone.change(""));
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Run ↵" }).hasAttribute("disabled")).toBe(true);
  await act(async () => finish(""));
  expect(onSubmit).not.toHaveBeenCalled();
  expect(onStop).not.toHaveBeenCalled();
});

test("只有附件也显示发送，移除附件后恢复停止", async () => {
  const onSubmit = vi.fn(async () => false), onStop = vi.fn();
  const attachment = { id: "image", name: "image.png", path: "/tmp/image.png", size: 3, mimeType: "image/png" };
  const view = render(<TaskComposer {...props} busy attachments={[attachment]} onSubmit={onSubmit} onStop={onStop} />);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Run ↵" }));
  expect(onSubmit).toHaveBeenCalledExactlyOnceWith("", [attachment]);
  expect(onStop).not.toHaveBeenCalled();
  view.rerender(<TaskComposer {...props} busy attachments={[]} onSubmit={onSubmit} onStop={onStop} />);
  expect(screen.getByRole("button", { name: "Stop" })).toBeTruthy();
});

test("停止期间禁止重复操作，录音按钮仍可使用，新草稿不会被清空", async () => {
  let finish!: () => void;
  const onStop = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  render(<TaskComposer {...props} busy onStop={onStop} />);
  const stop = screen.getByRole("button", { name: "Stop" });
  await userEvent.click(stop);
  await userEvent.click(stop);
  expect(onStop).toHaveBeenCalledOnce();
  expect(stop.hasAttribute("disabled")).toBe(true);
  await userEvent.type(screen.getByRole("textbox"), "New draft");
  expect(stop.getAttribute("aria-busy")).toBe("true");
  await userEvent.click(screen.getByRole("button", { name: "Voice input" }));
  expect(microphone.toggle).toHaveBeenCalledOnce();
  await act(async () => finish());
  expect(screen.getByRole("button", { name: "Run ↵" }).hasAttribute("disabled")).toBe(false);
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("New draft");
});

test("录音收尾时主按钮保持等待，不出现可点击的停止按钮", () => {
  microphone.state = "finishing";
  microphone.active = true;
  render(<TaskComposer {...props} busy />);
  expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  expect(screen.getByRole("button", { name: "Run ↵" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("button", { name: "Finish voice input" }).hasAttribute("disabled")).toBe(true);
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
