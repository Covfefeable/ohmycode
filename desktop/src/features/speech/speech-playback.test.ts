import { beforeEach, expect, test, vi } from "vitest";
import { SpeechPlayback } from "./speech-playback";

const sources: Array<{
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  buffer: AudioBuffer | null;
  onended: (() => void) | null;
}> = [];
let listeners: Map<string, (event: SpeechEvent) => void>;
beforeEach(() => {
  sources.length = 0;
  listeners = new Map();
  vi.stubGlobal(
    "AudioContext",
    class {
      currentTime = 1;
      destination = {};
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
      createBuffer(_channels: number, length: number, sampleRate: number) {
        return {
          duration: length / sampleRate,
          getChannelData: () => new Float32Array(length),
        };
      }
      createBufferSource() {
        const source = {
          start: vi.fn(),
          stop: vi.fn(),
          connect: vi.fn(),
          disconnect: vi.fn(),
          buffer: null,
          onended: null,
        };
        sources.push(source);
        return source;
      }
    },
  );
  Object.defineProperty(window, "ohmycode", {
    configurable: true,
    value: {
      speech: {
        onEvent: vi.fn((id: string, listener: (event: SpeechEvent) => void) => {
          listeners.set(id, listener);
          return () => {
            listeners.delete(id);
          };
        }),
        start: vi.fn(async () => {}),
        append: vi.fn(),
        finish: vi.fn(),
        stop: vi.fn(),
      },
    },
  });
});

test("PCM 音频按时间顺序播放，网络结束后仍等待音频播完", async () => {
  const state = vi.fn(),
    error = vi.fn();
  const playback = new SpeechPlayback(state, error);
  await playback.unlock();
  const task = playback.task();
  task.append("你好");
  task.finish();
  await Promise.resolve();
  const emit = [...listeners.values()][0];
  emit({ type: "audio", data: new Uint8Array([0, 0, 1]) });
  emit({ type: "audio", data: new Uint8Array([0, 2, 0]) });
  expect(sources[0].start).toHaveBeenCalledWith(1.04);
  expect(sources[1].start.mock.calls[0][0]).toBeGreaterThan(1.04);
  emit({ type: "finished" });
  expect(state).toHaveBeenLastCalledWith(true);
  sources.forEach((source) => source.onended?.());
  expect(state).toHaveBeenLastCalledWith(false);
  playback.dispose();
  expect(error).not.toHaveBeenCalled();
});

test("取消后不再发送尚未就绪的文字，同时清空监听和声音", async () => {
  let ready!: () => void;
  vi.mocked(window.ohmycode.speech.start).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  const playback = new SpeechPlayback(vi.fn(), vi.fn());
  await playback.unlock();
  const task = playback.task();
  task.append("不应发送");
  task.finish();
  playback.stop();
  ready();
  await Promise.resolve();
  expect(window.ohmycode.speech.append).not.toHaveBeenCalled();
  expect(window.ohmycode.speech.finish).not.toHaveBeenCalled();
  expect(listeners.size).toBe(0);
  playback.dispose();
});
