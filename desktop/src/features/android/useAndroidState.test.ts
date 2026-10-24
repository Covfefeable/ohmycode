import { renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useAndroidState } from "./useAndroidState";

it("设置页挂载时获取新设备状态，其他订阅者仍只读状态", async () => {
  const bridge = window.ohmycode;
  const fresh = { phase: "stopped", devices: [{ status: "device" }] };
  const refresh = vi.fn().mockResolvedValue(fresh);
  const state = vi.fn().mockResolvedValue({ phase: "stopped", devices: [] });
  window.ohmycode = { android: { refresh, state, onState: () => vi.fn() } } as unknown as typeof bridge;
  try {
    const view = renderHook(() => useAndroidState(true));
    await waitFor(() => expect(view.result.current.state).toEqual(fresh));
    expect(refresh).toHaveBeenCalledOnce();
    expect(state).not.toHaveBeenCalled();
    view.unmount();
    renderHook(() => useAndroidState());
    expect(state).toHaveBeenCalledOnce();
  } finally { window.ohmycode = bridge; }
});
