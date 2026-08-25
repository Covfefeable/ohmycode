import { API_URL } from "../config.js";
import { clearTokens, readTokens, storeTokens } from "./token-store.js";
import type { ApiResult, AuthPayload, AuthTokens } from "./types.js";

async function authRequest(pathname: string, init: RequestInit = {}): Promise<ApiResult> {
  const timeoutSignal = AbortSignal.timeout(8_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${API_URL}/api/auth${pathname}`, {
    ...init,
    signal,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return {
      ok: false,
      status: response.status,
      payload: {
        error: {
          code: response.status === 404 ? "incompatible_api" : "invalid_api_response",
        },
      },
    };
  }
  return { ok: response.ok, status: response.status, payload: await response.json() };
}

export async function authenticate(
  pathname: "/login" | "/register",
  payload: AuthPayload,
): Promise<ApiResult> {
  const result = await authRequest(pathname, { method: "POST", body: JSON.stringify(payload) });
  if (result.ok) {
    const tokens = result.payload.tokens as AuthTokens;
    await storeTokens(tokens);
  }
  return result;
}

export async function bootstrapAuth() {
  let tokens = await readTokens();
  if (!tokens) return { authenticated: false };

  let result = await authRequest("/me", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (result.ok) return { authenticated: true, user: result.payload.user };

  result = await authRequest("/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${tokens.refreshToken}` },
  });
  if (!result.ok) {
    await clearTokens();
    return { authenticated: false };
  }

  tokens = result.payload.tokens as AuthTokens;
  await storeTokens(tokens);
  const currentUser = await authRequest("/me", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (!currentUser.ok) {
    await clearTokens();
    return { authenticated: false };
  }
  return { authenticated: true, user: currentUser.payload.user };
}

export { clearTokens };
