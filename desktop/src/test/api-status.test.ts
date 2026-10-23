import { afterEach, expect, it, vi } from "vitest";
import { getApiStatus } from "../../electron/api/api-client";

const mocks = vi.hoisted(() => ({ getApiUrl: vi.fn(), readTokens: vi.fn() }));
vi.mock("../../electron/config", () => ({ getApiUrl: mocks.getApiUrl }));
vi.mock("../../electron/auth/token-store", () => ({ readTokens: mocks.readTokens, storeTokens: vi.fn() }));
vi.mock("../../electron/device/device-identity", () => ({ getDeviceIdentity: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it("健康检查使用当前地址且无需认证，HTTP 或连接失败返回离线", async () => {
  mocks.getApiUrl.mockReturnValue("http://example.test");
  const fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  expect(await getApiStatus()).toEqual({ online: true, url: "http://example.test" });
  expect(fetch).toHaveBeenCalledWith("http://example.test/api/health", { signal: expect.any(AbortSignal) });
  expect(mocks.readTokens).not.toHaveBeenCalled();
  mocks.getApiUrl.mockReturnValue("http://changed.test");
  fetch.mockResolvedValueOnce(new Response("", { status: 503 }));
  expect(await getApiStatus()).toEqual({ online: false, url: "http://changed.test" });
  fetch.mockRejectedValueOnce(new Error("offline"));
  expect(await getApiStatus()).toEqual({ online: false, url: "http://changed.test" });
});
