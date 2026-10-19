import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { VoiceOrb } from "./VoiceOrb";

const mocks = vi.hoisted(() => ({ output: 0, destroy: vi.fn(), setSpeed: vi.fn() }));
vi.mock("../speech/speech-context", () => ({ useSpeech: () => ({ playback }) }));
vi.mock("lottie-web", () => ({ default: { loadAnimation: () => ({ destroy: mocks.destroy, setSpeed: mocks.setSpeed }) } }));
const playback = { readLevel: () => mocks.output };
let draw: FrameRequestCallback;
let time: number;

beforeEach(() => {
  mocks.output = 0;
  mocks.destroy.mockClear();
  mocks.setSpeed.mockClear();
  time = 0;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { draw = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => vi.unstubAllGlobals());

function advance(milliseconds: number) {
  act(() => { for (let passed = 0; passed < milliseconds; passed += 16) { time += 16; draw(time); } });
}

test("停顿收束并呼吸，继续说话立即恢复音量反馈，发送后进入处理状态", async () => {
  const { container, rerender, unmount } = render(<VoiceOrb level={0} waiting={false} processing={false} />);
  await act(async () => {});
  const orb = container.firstElementChild!.firstElementChild as HTMLElement;
  const scale = () => Number(orb.style.transform.match(/scale\(([^)]+)\)/)![1]);
  advance(160);
  expect(scale()).toBe(1);
  rerender(<VoiceOrb level={0} waiting processing={false} />);
  advance(400);
  expect(scale()).toBeLessThan(0.88);
  expect(mocks.setSpeed).toHaveBeenLastCalledWith(0.5);
  const contracted = scale();
  advance(400);
  expect(scale()).not.toBeCloseTo(contracted, 3);
  rerender(<VoiceOrb level={0.4} waiting processing={false} />);
  advance(160);
  expect(scale()).toBeGreaterThan(1.2);
  expect(mocks.setSpeed).toHaveBeenLastCalledWith(1);
  rerender(<VoiceOrb level={0} waiting={false} processing />);
  advance(800);
  const processing = scale();
  advance(400);
  expect(scale()).not.toBeCloseTo(processing, 3);
  mocks.output = 0.4;
  advance(160);
  expect(scale()).toBeGreaterThan(1.2);
  unmount();
  expect(mocks.destroy).toHaveBeenCalledOnce();
  expect(cancelAnimationFrame).toHaveBeenCalled();
});
