export type AuthTokens = { accessToken: string; refreshToken: string };
export type User = { id: string; email: string; displayName: string };
export type AuthResponse = { tokens: AuthTokens; user: User };
export type ApiErrorPayload = { error?: { code?: string } };
