import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVoiceChat } from "./useVoiceChat";

const mocks = vi.hoisted(() => ({
  interrupt: vi.fn(), stopPlayback: vi.fn(), setRecording: vi.fn(), toast: vi.fn(),
}));
vi.mock("./speech-context", () => ({ useSpeech: () => ({
  settings: { hasApiKey: true, autoPlay: true }, playing: true,
  playback, setRecording: mocks.setRecording,
}) }));
vi.mock("../feedback", () => ({ useFeedback: () => ({ toast: mocks.toast }) }));
const playback = { stop: mocks.stopPlayback, interrupt: mocks.interrupt, releaseInput: vi.fn() };
let emit: (event: SpeechEvent) => void;
let port: { onmessage: ((event: { data: { data: ArrayBuffer; final: boolean } }) => void) | null };
const stopTrack = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.stubGlobal("AudioContext", class {
    destination = {};
    audioWorklet = { addModule: async () => {} };
    resume = async () => {};
    close = async () => {};
    createMediaStreamSource = () => ({ connect: vi.fn() });
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null, postMessage: vi.fn() };
    connect = vi.fn(); disconnect = vi.fn();
    constructor() { port = this.port; }
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })),
  } });
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { speech: {
    start: vi.fn(async () => {}), stop: vi.fn(), append: vi.fn(), finish: vi.fn(),
    onEvent: vi.fn((_id, callback) => { emit = callback; return vi.fn(); }),
  } } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

function speak() {
  port.onmessage!({ data: { data: new Int16Array(6400).fill(8000).buffer, final: false } });
}

test("短促杂音的中间识别不打断朗读，也不自动发送", async () => {
  const submit = vi.fn(async () => true);
  renderHook(() => useVoiceChat({ enabled: true, busy: true, onSubmit: submit, onStop: async () => {} }));
  await act(async () => {});
  act(() => {
    port.onmessage!({ data: { data: new Int16Array(1600).fill(8000).buffer, final: false } });
    emit({ type: "transcript", sentenceId: 1, text: "嗯", final: false });
    port.onmessage!({ data: { data: new Int16Array(1600).buffer, final: false } });
  });
  await act(async () => vi.advanceTimersByTime(3000));
  expect(mocks.interrupt).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

test("朗读期间轻声识别出完整句子，立即打断，停顿后停止旧任务并发送", async () => {
  const order: string[] = [];
  const stop = vi.fn(async () => { order.push("stop"); });
  const submit = vi.fn(async () => { order.push("send"); return true; });
  renderHook(() => useVoiceChat({ enabled: true, busy: true, onSubmit: submit, onStop: stop }));
  await act(async () => {});
  act(() => {
    port.onmessage!({ data: { data: new Int16Array(1600).fill(100).buffer, final: false } });
    emit({ type: "transcript", sentenceId: 1, text: "换一个话题", final: true });
  });
  expect(mocks.interrupt).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(1200));
  expect(submit).toHaveBeenCalledExactlyOnceWith("换一个话题");
  expect(order).toEqual(["stop", "send"]);
});

test("持续开麦、实时转写、句末自动发送，朗读期间的新语音打断但不重开麦克风", async () => {
  const submit = vi.fn(async () => true);
  const stop = vi.fn(async () => {});
  const { result, unmount } = renderHook(() => useVoiceChat({ enabled: true, busy: false, onSubmit: submit, onStop: stop }));
  await act(async () => {});
  act(() => emit({ type: "transcript", sentenceId: 1, text: "第一", final: false }));
  expect(result.current.text).toBe("第一");
  expect(mocks.interrupt).not.toHaveBeenCalled();
  act(speak);
  expect(mocks.interrupt).toHaveBeenCalledOnce();
  await act(async () => vi.advanceTimersByTime(2000));
  expect(submit).not.toHaveBeenCalled();
  act(() => emit({ type: "transcript", sentenceId: 1, text: "第一句。", final: true }));
  await act(async () => vi.advanceTimersByTime(1200));
  expect(submit).toHaveBeenCalledExactlyOnceWith("第一句。");
  expect(result.current.text).toBe("");
  expect(stopTrack).not.toHaveBeenCalled();
  expect(window.ohmycode.speech.start).toHaveBeenCalledOnce();
  act(() => emit({ type: "transcript", sentenceId: 2, text: "再说一句", final: false }));
  act(speak);
  expect(mocks.interrupt).toHaveBeenCalledTimes(2);
  expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
  unmount();
  expect(stopTrack).toHaveBeenCalledOnce();
});

test("倒计时期间继续发声会延后发送，正在运行时先停止上一轮再提交", async () => {
  const order: string[] = [];
  const submit = vi.fn(async () => { order.push("send"); return true; });
  const stop = vi.fn(async () => { order.push("stop"); });
  renderHook(() => useVoiceChat({ enabled: true, busy: true, onSubmit: submit, onStop: stop }));
  await act(async () => {});
  act(speak);
  act(() => emit({ type: "transcript", sentenceId: 1, text: "需求", final: true }));
  await act(async () => vi.advanceTimersByTime(1000));
  act(() => port.onmessage!({ data: { data: new Int16Array([16000, 16000]).buffer, final: false } }));
  await act(async () => vi.advanceTimersByTime(300));
  expect(submit).not.toHaveBeenCalled();
  act(() => emit({ type: "transcript", sentenceId: 2, text: "补充", final: false }));
  await act(async () => vi.advanceTimersByTime(2000));
  expect(submit).not.toHaveBeenCalled();
  act(() => emit({ type: "transcript", sentenceId: 2, text: "补充。", final: true }));
  await act(async () => vi.advanceTimersByTime(1200));
  expect(submit).toHaveBeenCalledExactlyOnceWith("需求补充。");
  expect(order).toEqual(["stop", "send"]);
});

test("提交失败暂停收音并保留文字，不自动重试；关闭模式取消待发送", async () => {
  const submit = vi.fn(async () => false);
  const { result, rerender } = renderHook(({ enabled }) => useVoiceChat({ enabled, busy: false, onSubmit: submit, onStop: async () => {} }), { initialProps: { enabled: true } });
  await act(async () => {});
  act(speak);
  act(() => emit({ type: "transcript", sentenceId: 1, text: "保留草稿", final: true }));
  await act(async () => vi.advanceTimersByTime(1200));
  expect(result.current.text).toBe("保留草稿");
  expect(result.current.state).toBe("idle");
  await act(async () => vi.advanceTimersByTime(10000));
  expect(submit).toHaveBeenCalledOnce();
  rerender({ enabled: false });
  await act(async () => vi.advanceTimersByTime(10000));
  expect(submit).toHaveBeenCalledOnce();
});

test("关闭时取消尚未发送的识别结果", async () => {
  const submit = vi.fn(async () => true);
  const { unmount } = renderHook(() => useVoiceChat({ enabled: true, busy: false, onSubmit: submit, onStop: async () => {} }));
  await act(async () => {});
  act(speak);
  act(() => emit({ type: "transcript", sentenceId: 1, text: "不要发送", final: true }));
  unmount();
  await act(async () => vi.advanceTimersByTime(2000));
  expect(submit).not.toHaveBeenCalled();
});
