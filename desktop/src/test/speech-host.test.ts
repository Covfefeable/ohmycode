import { EventEmitter } from "node:events";
import type { WebContents } from "electron";
import { expect, it, vi, type Mock } from "vitest";
import type { SpeechEvent } from "../../contracts/domain";
import { speechForWindow, stopSpeech } from "../../electron/speech/speech-host";

const { instances } = vi.hoisted(() => ({ instances: [] as Array<{ stop: Mock; emit(id: string, event: SpeechEvent): void }> }));
vi.mock("../../electron/speech/speech-service", () => ({ SpeechService: class {
  stop = vi.fn();
  constructor(readonly emit: (id: string, event: SpeechEvent) => void) { instances.push(this); }
} }));

it("语音按窗口复用且相互隔离，窗口销毁和全局停止都释放任务", () => {
  const createSender = (id: number) => Object.assign(new EventEmitter(), { id, isDestroyed: vi.fn(() => false), send: vi.fn() });
  const first = createSender(1);
  const second = createSender(2);
  const service = speechForWindow(first as unknown as WebContents);
  expect(speechForWindow(first as unknown as WebContents)).toBe(service);
  speechForWindow(second as unknown as WebContents);
  expect(instances).toHaveLength(2);
  expect(first.listenerCount("destroyed")).toBe(1);
  const event: SpeechEvent = { type: "error", code: "test_error" };
  instances[0].emit("task", event);
  expect(first.send).toHaveBeenCalledWith("speech:event:task", event);
  expect(second.send).not.toHaveBeenCalled();
  stopSpeech();
  expect(instances[0].stop).toHaveBeenCalledOnce();
  expect(instances[1].stop).toHaveBeenCalledOnce();
  first.isDestroyed.mockReturnValue(true);
  first.emit("destroyed");
  expect(instances[0].stop).toHaveBeenCalledTimes(2);
  first.send.mockClear();
  instances[0].emit("task", event);
  expect(first.send).not.toHaveBeenCalled();
  const replacement = createSender(1);
  expect(speechForWindow(replacement as unknown as WebContents)).not.toBe(service);
  replacement.emit("destroyed");
  second.emit("destroyed");
});
