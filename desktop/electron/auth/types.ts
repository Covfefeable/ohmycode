export type AuthTokens = { accessToken: string; refreshToken: string };
export type AuthPayload = { email: string; password: string; displayName?: string };
export type ApiResult = import("../../contracts/domain.js").AuthResponse & {
  payload: { tokens?: AuthTokens };
};

