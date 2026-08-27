import * as SecureStore from "expo-secure-store";

import type { AuthTokens } from "./types";

const TOKEN_KEY = "ohmycode.auth.tokens";

export async function readTokens(): Promise<AuthTokens | null> {
  const stored = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!stored) return null;
  try {
    return JSON.parse(stored) as AuthTokens;
  } catch {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return null;
  }
}

export function storeTokens(tokens: AuthTokens): Promise<void> {
  return SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
}

export function clearTokens(): Promise<void> {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}
