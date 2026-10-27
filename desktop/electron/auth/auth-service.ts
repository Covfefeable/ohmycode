import { getApiUrl } from "../config.js";
import { clearTokens, readTokens, storeTokens } from "./token-store.js";
import type { ApiResult, AuthPayload, AuthTokens } from "./types.js";
import type { AuthBootstrap, AuthResponse } from "../../contracts/domain.js";

async function authRequest(pathname: string, init: RequestInit = {}): Promise<ApiResult> {
  const timeoutSignal = AbortSignal.timeout(8_000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeoutSignal]) : timeoutSignal;
  const response = await fetch(`${getApiUrl()}/api/auth${pathname}`, {
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
): Promise<AuthResponse> {
  const result = await authRequest(pathname, { method: "POST", body: JSON.stringify(payload) });
  if (result.ok) {
    const tokens = result.payload.tokens as AuthTokens;
    await storeTokens(tokens);
  }
  return { ok: result.ok, status: result.status, payload: { user: result.payload.user, error: result.payload.error } };
}

export async function bootstrapAuth(): Promise<AuthBootstrap> {
  let tokens = await readTokens();
  if (!tokens) return { authenticated: false };

  let result = await authRequest("/me", {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
  });
  if (result.ok) {
    if (!result.payload.user) throw new Error("invalid_api_response");
    return { authenticated: true, user: result.payload.user };
  }

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
  if (!currentUser.payload.user) throw new Error("invalid_api_response");
  return { authenticated: true, user: currentUser.payload.user };
}

export { clearTokens };
