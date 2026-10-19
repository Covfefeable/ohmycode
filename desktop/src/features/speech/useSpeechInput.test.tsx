import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useSpeechInput } from "./useSpeechInput";

const mocks = vi.hoisted(() => ({
  stop: vi.fn(),
  toast: vi.fn(),
  setRecording: vi.fn(),
}));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));
vi.mock("./speech-context", () => ({
  useSpeech: () => ({
    settings: { hasApiKey: true },
    playback: { stop: mocks.stop },
    setRecording: mocks.setRecording,
  }),
}));
let emit: (event: SpeechEvent) => void;
const trackStop = vi.fn(),
  close = vi.fn(async () => {}),
  unsubscribe = vi.fn();
let node: {
  port: {
    onmessage:
      | ((event: { data: { data: ArrayBuffer; final: boolean } }) => void)
      | null;
    postMessage: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "AudioContext",
    class {
      audioWorklet = { addModule: vi.fn(async () => {}) };
      destination = {};
      resume = vi.fn(async () => {});
      close = close;
      createMediaStreamSource = () => ({ connect: vi.fn() });
    },
  );
  vi.stubGlobal(
    "AudioWorkletNode",
    class {
      port = { onmessage: null, postMessage: vi.fn() };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() {
        node = {
          port: this.port,
          connect: this.connect,
          disconnect: this.disconnect,
        };
      }
    },
  );
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: trackStop }],
      })),
    },
  });
  Object.defineProperty(window, "ohmycode", {
    configurable: true,
    value: {
      speech: {
        start: vi.fn(async () => {}),
        stop: vi.fn(),
        append: vi.fn(),
        finish: vi.fn(),
        onEvent: vi.fn((_id, callback) => {
          emit = callback;
          return unsubscribe;
        }),
      },
    },
  });
});

test("同一句识别结果替换修正，结束时冲刷残余音频，最终文字不丢失", async () => {
  const change = vi.fn();
  const { result, unmount } = renderHook(() =>
    useSpeechInput("原草稿", change),
  );
  await act(() => result.current.toggle());
  expect(result.current.state).toBe("recording");
  act(() => {
    emit({ type: "transcript", sentenceId: 1, text: "东", final: false });
    emit({ type: "transcript", sentenceId: 1, text: "东站。", final: true });
    emit({ type: "transcript", sentenceId: 2, text: "回盐城。", final: false });
  });
  expect(change.mock.calls.map(([text]) => text)).toEqual([
    "原草稿 东",
    "原草稿 东站。",
    "原草稿 东站。回盐城。",
  ]);
  await act(() => result.current.toggle());
  expect(result.current.state).toBe("finishing");
  expect(node.port.postMessage).toHaveBeenCalledWith("flush");
  act(() =>
    node.port.onmessage!({ data: { data: new ArrayBuffer(0), final: true } }),
  );
  expect(window.ohmycode.speech.finish).toHaveBeenCalledOnce();
  expect(trackStop).toHaveBeenCalledOnce();
  act(() => emit({ type: "finished" }));
  expect(result.current.state).toBe("idle");
  expect(close).toHaveBeenCalledOnce();
  unmount();
  expect(unsubscribe).toHaveBeenCalledOnce();
});

test("拒绝麦克风权限时恢复按钮状态，且不建立语音连接", async () => {
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValueOnce(
    new DOMException("denied", "NotAllowedError"),
  );
  const { result } = renderHook(() => useSpeechInput("", vi.fn()));
  await act(() => result.current.toggle());
  expect(result.current.state).toBe("idle");
  expect(window.ohmycode.speech.start).not.toHaveBeenCalled();
  expect(mocks.toast).toHaveBeenCalledOnce();
});

test("直接发送等待最终识别，返回修正后的完整草稿，不使用中间文本", async () => {
  const { result } = renderHook(() => useSpeechInput("草稿", vi.fn()));
  await act(() => result.current.toggle());
  act(() => emit({ type: "transcript", sentenceId: 1, text: "中间", final: false }));
  let finished!: Promise<string | null>;
  act(() => { finished = result.current.finish(); });
  const done = vi.fn();
  void finished.then(done);
  expect(node.port.postMessage).toHaveBeenCalledExactlyOnceWith("flush");
  act(() => node.port.onmessage!({ data: { data: new ArrayBuffer(2), final: true } }));
  expect(result.current.finish()).toBe(finished);
  expect(done).not.toHaveBeenCalled();
  await act(async () => {
    emit({ type: "transcript", sentenceId: 1, text: "最终文字。", final: true });
    emit({ type: "finished" });
    await finished;
  });
  expect(done).toHaveBeenCalledExactlyOnceWith("草稿 最终文字。");
});

test("结束识别失败或会话卸载时取消待发送，不发送残缺文本", async () => {
  const { result, unmount } = renderHook(() => useSpeechInput("", vi.fn()));
  await act(() => result.current.toggle());
  let failed!: Promise<string | null>;
  act(() => { failed = result.current.finish(); });
  await act(async () => { emit({ type: "error", code: "speech_timeout" }); });
  expect(await failed).toBeNull();
  await act(() => result.current.toggle());
  let cancelled!: Promise<string | null>;
  act(() => { cancelled = result.current.finish(); });
  unmount();
  expect(await cancelled).toBeNull();
});
