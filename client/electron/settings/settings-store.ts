import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app, safeStorage } from "electron";
import type { StoredSettings } from "./types.js";

const defaults: StoredSettings = { profile: { displayName: "", avatarPath: null }, models: [] };
const settingsFile = () => path.join(app.getPath("userData"), "settings.secure");

export async function readSettings(): Promise<StoredSettings> {
  try {
    const encrypted = Buffer.from(await readFile(settingsFile(), "utf8"), "base64");
    return JSON.parse(safeStorage.decryptString(encrypted)) as StoredSettings;
  } catch {
    return structuredClone(defaults);
  }
}

export async function writeSettings(settings: StoredSettings): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Secure settings storage unavailable");
  const encrypted = safeStorage.encryptString(JSON.stringify(settings));
  await writeFile(settingsFile(), encrypted.toString("base64"), { encoding: "utf8", mode: 0o600 });
}

