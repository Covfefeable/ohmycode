import { readTokens, storeTokens } from "../auth/token-store.js";
import type { AuthTokens } from "../auth/types.js";
import { getApiUrl } from "../config.js";
import { getDeviceIdentity } from "../device/device-identity.js";

export type ApiErrorCategory = "authentication" | "network" | "permission" | "provider" | "rate_limit" | "request" | "validation";

export type SerializedApiError = {
  code: string;
  category: ApiErrorCategory;
  retryable: boolean;
  status: number;
};

export const API_ERROR_PREFIX = "OHMYCODE_API_ERROR:";

function errorCategory(status: number, code: string): ApiErrorCategory {
  if (status === 401 || code === "authorization_required" || code === "provider_http_401") return "authentication";
  if (status === 403 || code === "provider_http_403") return "permission";
  if (status === 429 || code === "provider_http_429") return "rate_limit";
  if (code.startsWith("provider_http_")) return "provider";
  if (status === 422 || code === "model_not_configured") return "validation";
  if (status === 0) return "network";
  return "request";
}

export class ApiError extends Error {
  readonly category: ApiErrorCategory;
  readonly retryable: boolean;

  constructor(public status: number, public code: string) {
    const category = errorCategory(status, code);
    const retryable = category === "network" || category === "rate_limit" || status >= 500;
    const serialized: SerializedApiError = { status, code, category, retryable };
    super(`${API_ERROR_PREFIX}${JSON.stringify(serialized)}`);
    this.category = category;
    this.retryable = retryable;
  }
}

function networkApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, "network_error");
}

export function apiErrorCode(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.code : error instanceof Error ? error.message : fallback;
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
  let response: Response;
  try {
    response = await apiFetch(pathname, init);
  } catch (error) {
    throw networkApiError(error);
  }
  if (!response.ok) throw await apiErrorFromResponse(response);
  if (response.status === 204) return undefined as T;
  try {
    return await response.json() as T;
  } catch {
    throw new ApiError(502, "invalid_api_response");
  }
}
