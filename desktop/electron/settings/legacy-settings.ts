import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { StoredSettings } from "./types.js";

const legacyFile = () => path.join(app.getPath("userData"), "settings.secure");

export async function readLegacySettings(): Promise<StoredSettings | null> {
  try {
    const encrypted = Buffer.from(await readFile(legacyFile(), "utf8"), "base64");
    return JSON.parse(safeStorage.decryptString(encrypted)) as StoredSettings;
  } catch {
    return null;
  }
}

export async function removeLegacySettings(): Promise<void> {
  try { await unlink(legacyFile()); } catch { /* Already migrated or absent. */ }
}
