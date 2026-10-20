import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { useConversationModel } from "./useConversationModel";

const models = [{ id: "first", name: "First" }, { id: "second", name: "Second" }] as ModelConfiguration[];
let changed: (models: ModelConfiguration[]) => void;
const listModels = vi.fn();

beforeEach(() => {
  sessionStorage.clear();
  listModels.mockReset().mockResolvedValue(models);
  Object.defineProperty(window, "ohmycode", { configurable: true, value: { settings: {
    listModels,
    onModelsChanged: (listener: typeof changed) => { changed = listener; return () => {}; },
  } } });
});

test("切换会话及返回页面时分别恢复所选模型，新会话使用默认模型", async () => {
  const first = renderHook(() => useConversationModel("one"));
  await waitFor(() => expect(first.result.current.selectedModelId).toBe("first"));
  act(() => first.result.current.setSelectedModelId("second"));
  first.unmount();
  const other = renderHook(() => useConversationModel("two"));
  await waitFor(() => expect(other.result.current.selectedModelId).toBe("first"));
  other.unmount();
  const restored = renderHook(() => useConversationModel("one"));
  await waitFor(() => expect(restored.result.current.models).toHaveLength(2));
  expect(restored.result.current.selectedModelId).toBe("second");
});

test("模型排序和编辑不改变选择，删除后回退默认，空列表清除选择", async () => {
  const hook = renderHook(() => useConversationModel("one"));
  await waitFor(() => expect(hook.result.current.models).toHaveLength(2));
  act(() => hook.result.current.setSelectedModelId("second"));
  act(() => changed([...models].reverse()));
  expect(hook.result.current.selectedModelId).toBe("second");
  act(() => changed([models[0]]));
  expect(hook.result.current.selectedModelId).toBe("first");
  act(() => changed([]));
  expect(hook.result.current.selectedModelId).toBe("");
  act(() => changed(models));
  expect(hook.result.current.selectedModelId).toBe("first");
});

test("较晚返回的模型列表不能覆盖更新事件", async () => {
  let resolve!: (models: ModelConfiguration[]) => void;
  listModels.mockReturnValue(new Promise<ModelConfiguration[]>((done) => { resolve = done; }));
  const hook = renderHook(() => useConversationModel("one"));
  act(() => changed([models[1]]));
  await act(async () => resolve(models));
  expect(hook.result.current.models).toEqual([models[1]]);
  expect(hook.result.current.selectedModelId).toBe("second");
});

test("重试加载不会把仍然可用的选择重置为默认模型", async () => {
  const hook = renderHook(({ retry }) => useConversationModel("one", retry), { initialProps: { retry: 0 } });
  await waitFor(() => expect(hook.result.current.models).toHaveLength(2));
  act(() => hook.result.current.setSelectedModelId("second"));
  await act(async () => hook.rerender({ retry: 1 }));
  expect(listModels).toHaveBeenCalledTimes(2);
  expect(hook.result.current.selectedModelId).toBe("second");
});
