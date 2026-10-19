import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useCustomVoices } from "./useCustomVoices";

const pending: CustomVoice = {
  id: "one",
  voiceId: "voice-one",
  name: "My voice",
  status: "DEPLOYING",
};
beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(window, "ohmycode", {
    configurable: true,
    value: {
      speech: {
        listVoices: vi.fn(async () => [pending]),
        refreshVoices: vi.fn(async () => [{ ...pending, status: "OK" }]),
      },
    },
  });
});
afterEach(() => vi.useRealTimers());

test("只在音色处理中间隔刷新，变为可用后停止", async () => {
  const { result } = renderHook(() => useCustomVoices("workspace", true));
  await act(async () => {});
  expect(result.current.voices[0].status).toBe("DEPLOYING");
  await act(() => vi.advanceTimersByTimeAsync(4999));
  expect(window.ohmycode.speech.refreshVoices).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(result.current.voices[0].status).toBe("OK");
  await act(() => vi.advanceTimersByTimeAsync(20000));
  expect(window.ohmycode.speech.refreshVoices).toHaveBeenCalledOnce();
});

test("切换业务空间不回显旧空间音色，过期请求不覆盖新空间", async () => {
  let old!: (voices: CustomVoice[]) => void;
  vi.mocked(window.ohmycode.speech.listVoices)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          old = resolve;
        }),
    )
    .mockResolvedValueOnce([]);
  const { result, rerender } = renderHook(
    ({ workspace }) => useCustomVoices(workspace, true),
    { initialProps: { workspace: "old" } },
  );
  rerender({ workspace: "new" });
  await act(async () => {});
  await act(async () => old([pending]));
  expect(result.current.voices).toEqual([]);
});

test("未配置不请求，失败保留错误供手动刷新，不自动重复创建", async () => {
  const { result, rerender } = renderHook(
    ({ configured }) => useCustomVoices("workspace", configured),
    { initialProps: { configured: false } },
  );
  expect(window.ohmycode.speech.listVoices).not.toHaveBeenCalled();
  vi.mocked(window.ohmycode.speech.listVoices).mockRejectedValueOnce(
    new Error("offline"),
  );
  rerender({ configured: true });
  await act(async () => {});
  expect(result.current.failed).toBe(true);
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(window.ohmycode.speech.refreshVoices).not.toHaveBeenCalled();
  act(() => result.current.refresh());
  await act(async () => {});
  expect(result.current.failed).toBe(false);
  expect(result.current.voices[0].status).toBe("OK");
});
