import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVoiceRecording } from "./useVoiceRecording";
import { audioBase64, wavRecording } from "./voice-recording";

const stopTrack = vi.fn(), close = vi.fn(async () => {});
let node: { port: { onmessage: ((event: { data: { data: ArrayBuffer; final: boolean } }) => void) | null; postMessage: ReturnType<typeof vi.fn> } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("AudioContext", class {
    audioWorklet = { addModule: vi.fn(async () => {}) };
    destination = {};
    resume = vi.fn(async () => {});
    close = close;
    createMediaStreamSource = () => ({ connect: vi.fn() });
  });
  vi.stubGlobal("AudioWorkletNode", class {
    port = { onmessage: null, postMessage: vi.fn() };
    connect = vi.fn(); disconnect = vi.fn();
    constructor() { node = { port: this.port }; }
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
    getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop: stopTrack }] })),
  } });
});
afterEach(() => vi.unstubAllGlobals());

test("WAV 封装保留 PCM 内容及采样参数", async () => {
  const wav = wavRecording([new Int16Array([1, -1]).buffer], 16000);
  const bytes = Uint8Array.from(atob(await audioBase64(wav)), (character) => character.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint32(40, true)).toBe(4);
  expect(view.getInt16(44, true)).toBe(1);
  expect(view.getInt16(46, true)).toBe(-1);
});

test("停止先冲刷尾帧，录音满 30 秒自动结束并释放麦克风", async () => {
  const { result } = renderHook(() => useVoiceRecording());
  await act(() => result.current.start());
  act(() => result.current.stop());
  expect(node.port.postMessage).toHaveBeenCalledWith("flush");
  act(() => node.port.onmessage!({ data: { data: new ArrayBuffer(16000 * 31 * 2), final: false } }));
  expect(result.current.seconds).toBe(30);
  expect(result.current.audio?.size).toBe(44 + 16000 * 30 * 2);
  expect(result.current.state).toBe("idle");
  expect(stopTrack).toHaveBeenCalledOnce();
});

test("关闭时释放资源，迟到的麦克风授权也释放", async () => {
  let resolve!: (stream: MediaStream) => void;
  vi.mocked(navigator.mediaDevices.getUserMedia).mockImplementation(() => new Promise((done) => { resolve = done; }));
  const { result, unmount } = renderHook(() => useVoiceRecording());
  let pending!: Promise<void>;
  act(() => { pending = result.current.start(); });
  unmount();
  await act(async () => {
    resolve({ getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream);
    await pending;
  });
  expect(stopTrack).toHaveBeenCalledOnce();
});

test("拒绝麦克风权限保留错误，不留下录音状态", async () => {
  const failure = new DOMException("denied", "NotAllowedError");
  vi.mocked(navigator.mediaDevices.getUserMedia).mockRejectedValue(failure);
  const { result } = renderHook(() => useVoiceRecording());
  await act(() => result.current.start());
  expect(result.current.state).toBe("idle");
  expect(result.current.error).toBe(failure);
});
