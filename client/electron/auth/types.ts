export type AuthTokens = { accessToken: string; refreshToken: string };
export type AuthPayload = { email: string; password: string; displayName?: string };
export type ApiResult = { ok: boolean; status: number; payload: Record<string, unknown> };

