import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { SpeechProvider } from "../../features/speech/SpeechProvider";
import { GroupChatPanel } from "./GroupChatPanel";

const mocks = vi.hoisted(() => ({
  toast: vi.fn(), append: vi.fn(), finish: vi.fn(), stop: vi.fn(),
  task: vi.fn(), onState: vi.fn<(active: boolean) => void>(),
}));
vi.mock("../../features/feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));
vi.mock("../../shared/ui/prompt-editor", () => ({ PromptEditor: () => null, usePromptCapabilities: () => [] }));
vi.mock("./RunDetailDialog", () => ({ RunDetailDialog: () => null }));
vi.mock("../../features/speech/speech-playback", () => ({ SpeechPlayback: class {
  constructor(onState: (active: boolean) => void) { mocks.onState.mockImplementation(onState); }
  stop = mocks.stop;
  task = mocks.task;
  resume = vi.fn();
  unlock = vi.fn(async () => {});
  dispose = vi.fn();
} }));

const settings: SpeechSettings = { workspaceId: "workspace", voice: "voice", autoPlay: false, hasApiKey: true };
const task: MultiAgentTask = {
  id: "task", agentId: "team", title: "Team", request: "Discuss", status: "completed",
  workspacePath: "/workspace", executionLimit: 10, executionCount: 1, createdAt: "", updatedAt: "",
  members: [{ id: "host", key: "host", name: "Host", role: "Host", instructions: "Guide", isHost: true, sortOrder: 0, status: "completed", changedFiles: [] }],
  messages: [
    { id: "user", fromNodeId: null, toNodeId: "host", runId: null, type: "message", senderType: "user", content: "Question", createdAt: "2026-10-20T00:00:00Z" },
    { id: "answer", fromNodeId: "host", toNodeId: null, runId: null, type: "message", senderType: "agent", content: "这是**回答**。\n\n```sh\n不要朗读命令\n```", createdAt: "2026-10-20T00:01:00Z" },
    { id: "another", fromNodeId: "host", toNodeId: null, runId: null, type: "message", senderType: "agent", content: "另一条回答。", createdAt: "2026-10-20T00:02:00Z" },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.stop.mockImplementation(() => mocks.onState(false));
  mocks.task.mockImplementation(() => {
    mocks.onState(true);
    return { append: mocks.append, finish: mocks.finish };
  });
  Object.defineProperty(window, "ohmycode", { configurable: true, value: {
    speech: { getSettings: vi.fn(async () => settings) },
  } });
});

function openChat() {
  return render(<SpeechProvider><GroupChatPanel task={task} message="" sending={false} liveAgentRuns={{}} onMessageChange={() => {}} onSend={() => {}} /></SpeechProvider>);
}

test("只给 Agent 消息增加朗读，关闭自动朗读仍可手动播放，复用正文清洗和停止能力", async () => {
  openChat();
  await act(async () => {});
  expect(screen.getAllByRole("button", { name: "Read aloud" })).toHaveLength(2);
  expect(mocks.task).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Read aloud" })[0]);
  await waitFor(() => expect(mocks.append).toHaveBeenCalledWith("这是回答。"));
  expect(mocks.finish).toHaveBeenCalledOnce();
  expect(screen.getByRole("button", { name: "Stop reading" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Stop reading" }));
  expect(mocks.stop).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole("button", { name: "Read aloud" })).toHaveLength(2);
});

test("播放另一条消息会停止前一条，停止按钮只关联正在朗读的消息", async () => {
  openChat();
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button", { name: "Read aloud" })[0]);
  await waitFor(() => expect(mocks.task).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole("button", { name: "Read aloud" }));
  await waitFor(() => expect(mocks.append).toHaveBeenLastCalledWith("另一条回答。"));
  expect(mocks.stop).toHaveBeenCalledTimes(2);
  expect(screen.getAllByRole("button", { name: "Stop reading" })).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Read aloud" })).toHaveLength(1);
});

test("没有配置语音时提示配置错误，不启动合成", async () => {
  window.ohmycode.speech.getSettings = vi.fn(async () => ({ ...settings, hasApiKey: false }));
  openChat();
  await act(async () => {});
  fireEvent.click(screen.getAllByRole("button", { name: "Read aloud" })[0]);
  await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ type: "error" })));
  expect(mocks.task).not.toHaveBeenCalled();
});
