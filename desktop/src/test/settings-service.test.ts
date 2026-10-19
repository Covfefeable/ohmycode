import { expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../electron/api/api-client.js", () => ({ apiRequest: mocks.request, apiFetch: vi.fn() }));
import { getModels, getPublicSettings } from "../../electron/settings/settings-service";

test("聊天模型查询不读取头像或完整设置", async () => {
  mocks.request.mockResolvedValueOnce([]);
  await expect(getModels()).resolves.toEqual([]);
  expect(mocks.request.mock.calls).toEqual([["/api/settings/models"]]);
});

test("读取完整设置不会附带旧配置迁移写入", async () => {
  mocks.request.mockClear();
  mocks.request.mockResolvedValueOnce({ profile: { avatarAvailable: false }, models: [] });
  await getPublicSettings();
  expect(mocks.request.mock.calls).toEqual([["/api/settings"]]);
});
