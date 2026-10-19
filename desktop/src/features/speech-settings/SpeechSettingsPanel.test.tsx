import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { SpeechSettingsPanel } from "./SpeechSettingsPanel";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(async () => {}),
  update: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("../speech/speech-context", () => ({
  useSpeech: () => ({
    settings: {
      workspaceId: "llm-demo",
      voice: "longanhuan_v3.1",
      hasApiKey: true,
      autoPlay: false,
    },
    refresh: mocks.refresh,
    update: mocks.update,
  }),
}));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));

test("语音凭据不回显，保存保持按钮文案并清空填写的 Key", async () => {
  const save = vi.fn(async () => ({
    workspaceId: "llm-demo",
    voice: "longanhuan_v3.1",
    hasApiKey: true,
    autoPlay: false,
  }));
  Object.defineProperty(window, "ohmycode", {
    configurable: true,
    value: {
      speech: { saveSettings: save, listVoices: vi.fn(async () => []) },
    },
  });
  render(<SpeechSettingsPanel />);
  expect(screen.queryByText("qwen-audio-3.1-asr-flash-message")).toBeNull();
  expect(screen.queryByText("qwen-audio-3.1-tts-flash")).toBeNull();
  expect(screen.getByLabelText("Workspace ID")).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Voice ID" }));
  expect(screen.getByRole("option", { name: "Qiao Xiaojiao" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Andy" })).toBeTruthy();
  await userEvent.keyboard("{Escape}");
  const input = screen.getByLabelText("API key") as HTMLInputElement;
  expect(input.value).toBe("");
  expect(input.type).toBe("password");
  fireEvent.change(input, { target: { value: "test-key" } });
  await userEvent.click(screen.getByRole("button", { name: "Save voice settings" }));
  await waitFor(() => expect(input.value).toBe(""));
  expect(save).toHaveBeenCalledWith({
    workspaceId: "llm-demo",
    voice: "longanhuan_v3.1",
    apiKey: "test-key",
  });
  expect(mocks.update).toHaveBeenCalled();
  await act(async () => {});
});
