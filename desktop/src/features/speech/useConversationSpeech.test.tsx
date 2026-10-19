import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useConversationSpeech } from "./useConversationSpeech";

const mock = vi.hoisted(() => ({
  task: vi.fn(),
  stop: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  enabled: true,
}));
vi.mock("./speech-context", () => ({
  useSpeech: () => ({ settings: { autoPlay: mock.enabled }, playback }),
}));
const playback = { task: mock.task, stop: mock.stop };
let emit: (event: RuntimeEvent) => void;
beforeEach(() => {
  vi.clearAllMocks();
  mock.enabled = true;
  mock.task.mockReturnValue({ append: mock.append, finish: mock.finish });
  Object.defineProperty(window, "ohmycode", {
    configurable: true,
    value: {
      conversations: {
        onThreadEvent: vi.fn((_id, callback) => {
          emit = callback;
          return vi.fn();
        }),
      },
    },
  });
});
const base = { threadId: "thread", turnId: "turn", timestamp: "" };
const item = {
  id: "step",
  threadId: "thread",
  turnId: "turn",
  kind: "agent_message" as const,
  status: "in_progress" as const,
  content: "",
};

test("步骤文字流式朗读、去重重放事件，工具和思考不读", () => {
  renderHook(() => useConversationSpeech("thread"));
  act(() => {
    emit({ ...base, type: "turn.started", sequence: 1 });
    emit({ ...base, type: "item.started", sequence: 2, item });
    emit({
      ...base,
      type: "item.delta",
      sequence: 3,
      itemId: "step",
      delta: "再确认**东站**。",
    });
    emit({
      ...base,
      type: "item.delta",
      sequence: 3,
      itemId: "step",
      delta: "再确认**东站**。",
    });
    emit({
      ...base,
      type: "item.delta",
      sequence: 4,
      itemId: "hidden",
      delta: "思考",
    });
  });
  expect(mock.append.mock.calls.flat()).toEqual(["再确认东站。"]);
  act(() =>
    emit({
      ...base,
      type: "item.completed",
      sequence: 5,
      item: { ...item, status: "completed", content: "再确认**东站**。" },
    }),
  );
  expect(mock.finish).toHaveBeenCalledOnce();
  expect(mock.append).toHaveBeenCalledOnce();
});

test("关闭自动朗读后不订阅输出，运行中关闭会立即停止", () => {
  const { rerender } = renderHook(() => useConversationSpeech("thread"));
  mock.enabled = false;
  rerender();
  expect(mock.stop).toHaveBeenCalled();
  act(() =>
    emit({
      ...base,
      type: "item.delta",
      sequence: 3,
      itemId: "step",
      delta: "不应朗读。",
    }),
  );
  expect(mock.task).not.toHaveBeenCalled();
});
