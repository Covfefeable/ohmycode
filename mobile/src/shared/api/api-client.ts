import * as Device from "expo-device";
import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";
import { fetch as expoFetch } from "expo/fetch";

import { clearTokens, readTokens, storeTokens } from "./token-store";
import type { ApiErrorPayload, AuthResponse, AuthTokens, User } from "./types";

function developmentApiUrl(): string | null {
  const hostUri = Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost;
  const host = hostUri?.match(/^\[([^\]]+)\]|^([^:]+)/)?.slice(1).find(Boolean);
  return host ? `http://${host}:8765` : null;
}

const apiUrl = (
  process.env.EXPO_PUBLIC_API_URL
  ?? (__DEV__ ? developmentApiUrl() : null)
  ?? "http://ai.llmol.com:8765"
).replace(/\/+$/, "");
const DEVICE_ID_KEY = "ohmycode.device.id";

export class ApiError extends Error {
  constructor(public readonly code: string, public readonly status = 0) {
    super(code);
  }
}

async function deviceHeaders(): Promise<Record<string, string>> {
  let id = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (!id) {
    id = `mobile-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  }
  return {
    "X-OhMyCode-Device-Id": id,
    "X-OhMyCode-Device-Name": encodeURIComponent(Device.deviceName ?? "Mobile"),
  };
}

async function decode<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (!response.ok) throw new ApiError(payload.error?.code ?? "request_failed", response.status);
  return payload;
}

async function request<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  try {
    return await decode<T>(await expoFetch(`${apiUrl}${pathname}`, {
      ...init,
      body: init.body ?? undefined,
      headers: { "Content-Type": "application/json", ...init.headers },
    } as Parameters<typeof expoFetch>[1]));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("network_error");
  }
}

export async function authenticate(
  mode: "login" | "register",
  payload: { email: string; password: string; displayName?: string },
): Promise<AuthResponse> {
  const result = await request<AuthResponse>(`/api/auth/${mode}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  await storeTokens(result.tokens);
  return result;
}

async function refresh(refreshToken: string): Promise<AuthTokens | null> {
  try {
    const result = await request<{ tokens: AuthTokens }>("/api/auth/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${refreshToken}` },
    });
    await storeTokens(result.tokens);
    return result.tokens;
  } catch {
    return null;
  }
}

export async function bootstrapUser(): Promise<User | null> {
  let tokens = await readTokens();
  if (!tokens) return null;
  const loadUser = (accessToken: string) => request<{ user: User }>("/api/auth/me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  try {
    return (await loadUser(tokens.accessToken)).user;
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  }
  tokens = await refresh(tokens.refreshToken);
  if (!tokens) {
    await clearTokens();
    return null;
  }
  try {
    return (await loadUser(tokens.accessToken)).user;
  } catch {
    await clearTokens();
    return null;
  }
}

export async function authenticatedRequest<T>(pathname: string, init: RequestInit = {}): Promise<T> {
  return decode<T>(await authenticatedFetch(pathname, init));
}

export async function authenticatedFetch(
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  let tokens = await readTokens();
  if (!tokens) throw new ApiError("authorization_required", 401);
  const execute = async (accessToken: string) => {
    try {
      return await expoFetch(`${apiUrl}${pathname}`, {
        ...init,
        body: init.body ?? undefined,
        headers: {
          "Content-Type": "application/json",
          ...await deviceHeaders(),
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
      } as Parameters<typeof expoFetch>[1]);
    } catch {
      throw new ApiError("network_error");
    }
  };
  let response = await execute(tokens.accessToken);
  if (response.status !== 401) {
    if (!response.ok) await decode(response);
    return response;
  }
  tokens = await refresh(tokens.refreshToken);
  if (!tokens) throw new ApiError("authorization_required", 401);
  response = await execute(tokens.accessToken);
  if (!response.ok) await decode(response);
  return response;
}
