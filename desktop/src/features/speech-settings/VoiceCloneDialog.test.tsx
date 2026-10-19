import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { VoiceCloneDialog } from "./VoiceCloneDialog";

vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: vi.fn() }) }));
vi.mock("./VoiceRecorder", () => ({
  VoiceRecorder: ({ onChange }: { onChange(audio: Blob): void }) => <button type="button" onClick={() => onChange(new Blob(["wav"], { type: "audio/wav" }))}>Record</button>,
}));

test("创建音色提交参考音频及配置，处理期间保留按钮文案并阻止重复提交", async () => {
  const user = userEvent.setup();
  let finish!: (voice: CustomVoice) => void;
  const createVoice = vi.fn(
    () =>
      new Promise<CustomVoice>((resolve) => {
        finish = resolve;
      }),
  );
  Object.defineProperty(window, "ohmycode", {
    configurable: true,
    value: { speech: { createVoice } },
  });
  const onClose = vi.fn(),
    onCreated = vi.fn();
  render(<VoiceCloneDialog onClose={onClose} onCreated={onCreated} />);
  expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");
  await user.type(screen.getByLabelText("Voice name"), "My voice");
  await user.click(screen.getByRole("button", { name: "Record" }));
  await user.click(
    screen.getByLabelText("Audio noise reduction and enhancement"),
  );
  await user.click(screen.getByLabelText(/I have permission/));
  const create = screen.getByRole("button", { name: "Create voice" });
  await user.click(create);
  await user.click(create);
  expect(createVoice).toHaveBeenCalledExactlyOnceWith({
    name: "My voice",
    audioData: "d2F2",
    language: "zh",
    preprocess: true,
    consent: true,
  });
  expect((create as HTMLButtonElement).disabled).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(onClose).not.toHaveBeenCalled();
  const voice: CustomVoice = {
    id: "one",
    voiceId: "custom",
    name: "My voice",
    status: "DEPLOYING",
  };
  finish(voice);
  await waitFor(() => expect(onCreated).toHaveBeenCalledWith(voice));
  expect(onClose).toHaveBeenCalledOnce();
});
