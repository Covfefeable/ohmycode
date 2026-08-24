import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { AuthTokens } from "./types.js";

function tokenFile(): string {
  return path.join(app.getPath("userData"), "auth.tokens");
}

export async function readTokens(): Promise<AuthTokens | null> {
  try {
    const encrypted = Buffer.from(await readFile(tokenFile(), "utf8"), "base64");
    return JSON.parse(safeStorage.decryptString(encrypted)) as AuthTokens;
  } catch {
    return null;
  }
}

export async function storeTokens(tokens: AuthTokens): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure token storage is unavailable");
  const encrypted = safeStorage.encryptString(JSON.stringify(tokens));
  await writeFile(tokenFile(), encrypted.toString("base64"), { encoding: "utf8", mode: 0o600 });
}

export async function clearTokens(): Promise<void> {
  try {
    await unlink(tokenFile());
  } catch {
    // The user is already signed out.
  }
}

