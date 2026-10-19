import { beforeEach, expect, it, vi } from "vitest";
import { bootstrapUser } from "./api-client";

const mocks = vi.hoisted(() => {
  Object.assign(globalThis, { __DEV__: false });
  return { fetch: vi.fn(), read: vi.fn(), store: vi.fn(), clear: vi.fn() };
});
vi.mock("expo-device", () => ({ deviceName: "Test" }));
vi.mock("expo-constants", () => ({ default: {} }));
vi.mock("expo-secure-store", () => ({ getItemAsync: vi.fn(), setItemAsync: vi.fn() }));
vi.mock("expo/fetch", () => ({ fetch: mocks.fetch }));
vi.mock("./token-store", () => ({ readTokens: mocks.read, storeTokens: mocks.store, clearTokens: mocks.clear }));

const response = (status: number, payload: object) => ({ ok: status < 400, status, json: async () => payload });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.read.mockResolvedValue({ accessToken: "expired", refreshToken: "refresh" });
  mocks.fetch.mockReset();
  mocks.fetch.mockResolvedValueOnce(response(401, { error: { code: "token_expired" } }));
});

it("retains credentials when refresh has a network failure", async () => {
  mocks.fetch.mockRejectedValueOnce(new TypeError("offline"));
  await expect(bootstrapUser()).rejects.toMatchObject({ code: "network_error" });
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("retains refreshed credentials when loading the user returns 503", async () => {
  mocks.fetch.mockResolvedValueOnce(response(200, { tokens: { accessToken: "new", refreshToken: "new-refresh" } }));
  mocks.fetch.mockResolvedValueOnce(response(503, { error: { code: "unavailable" } }));
  await expect(bootstrapUser()).rejects.toMatchObject({ status: 503 });
  expect(mocks.store).toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
});

it("clears credentials only for a rejected refresh token", async () => {
  mocks.fetch.mockResolvedValueOnce(response(401, { error: { code: "invalid_token" } }));
  await expect(bootstrapUser()).resolves.toBeNull();
  expect(mocks.clear).toHaveBeenCalledOnce();
});
