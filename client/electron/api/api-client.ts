import { readTokens, storeTokens } from "../auth/token-store.js";
import type { AuthTokens } from "../auth/types.js";
import { API_URL } from "../config.js";

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

async function refreshAccessToken(refreshToken: string): Promise<AuthTokens | null> {
  const response = await fetch(`${API_URL}/api/auth/refresh`, { method: "POST", headers: { Authorization: `Bearer ${refreshToken}` } });
  if (!response.ok) return null;
  const payload = await response.json() as { tokens: AuthTokens };
  await storeTokens(payload.tokens);
  return payload.tokens;
}

export async function apiFetch(pathname: string, init: RequestInit = {}): Promise<Response> {
  let tokens = await readTokens();
  if (!tokens) throw new ApiError(401, "authorization_required");
  const execute = (accessToken: string) => fetch(`${API_URL}${pathname}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...init.headers },
  });
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
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { code?: string } };
    throw new ApiError(response.status, payload.error?.code ?? "request_failed");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
