import { beforeEach, expect, it, vi } from "vitest";
import { authenticate, bootstrapAuth } from "../../electron/auth/auth-service";

const store = vi.hoisted(() => ({ readTokens: vi.fn(), storeTokens: vi.fn(), clearTokens: vi.fn() }));
vi.mock("../../electron/auth/token-store", () => store);
vi.mock("../../electron/config", () => ({ getApiUrl: () => "https://example.com" }));
const user = { id: "user", email: "user@example.com", displayName: "User", createdAt: "2026-10-28" };
const tokens = { accessToken: "test-access-token", refreshToken: "test-refresh-token" };

beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal("fetch", vi.fn()); });

it("登录凭据只保存到主进程，Renderer 只收到公开响应", async () => {
  vi.mocked(fetch).mockResolvedValue(Response.json({ user, tokens }));
  expect(await authenticate("/login", { email: user.email, password: "test-password" })).toEqual({ ok: true, status: 200, payload: { user, error: undefined } });
  expect(store.storeTokens).toHaveBeenCalledWith(tokens);
});

it("启动鉴权和刷新共用用户契约，服务响应缺少用户不能伪装登录成功", async () => {
  store.readTokens.mockResolvedValue(tokens);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: { code: "expired" } }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ tokens }))
    .mockResolvedValueOnce(Response.json({ user }));
  expect(await bootstrapAuth()).toEqual({ authenticated: true, user });
  expect(store.storeTokens).toHaveBeenCalledWith(tokens);
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({}));
  await expect(bootstrapAuth()).rejects.toThrow("invalid_api_response");
});
