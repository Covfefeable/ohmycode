import { readTokens, storeTokens } from "../auth/token-store.js";
import type { AuthTokens } from "../auth/types.js";
import { getApiUrl } from "../config.js";
import { getDeviceIdentity } from "../device/device-identity.js";

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({})) as { error?: { code?: string } }
    : {};
  const code = response.status === 404 && !contentType.includes("application/json")
    ? "incompatible_api"
    : payload.error?.code ?? "request_failed";
  return new ApiError(response.status, code);
}

async function refreshAccessToken(refreshToken: string): Promise<AuthTokens | null> {
  const response = await fetch(`${getApiUrl()}/api/auth/refresh`, { method: "POST", headers: { Authorization: `Bearer ${refreshToken}` } });
  if (!response.ok) return null;
  const payload = await response.json() as { tokens: AuthTokens };
  await storeTokens(payload.tokens);
  return payload.tokens;
}

export async function apiFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  let tokens = await readTokens();
  if (!tokens) throw new ApiError(401, "authorization_required");
  const device = await getDeviceIdentity();
  const execute = (accessToken: string) => {
    const headers = new Headers(init.headers);
    if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    headers.set("Authorization", `Bearer ${accessToken}`);
    headers.set("X-OhMyCode-Device-Id", device.id);
    headers.set("X-OhMyCode-Device-Name", encodeURIComponent(device.name));
    return fetch(`${getApiUrl()}${pathname}`, { ...init, headers });
  };
  let response = await execute(tokens.accessToken);
  if (response.status === 401) {
    tokens = await refreshAccessToken(tokens.refreshToken);
    if (!tokens) throw new ApiError(401, "authorization_required");
    response = await execute(tokens.accessToken);
  }
  return response;
}

export async function apiRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(pathname, init);
  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
