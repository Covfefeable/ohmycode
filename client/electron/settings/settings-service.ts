import { readFile } from "node:fs/promises";
import path from "node:path";
import { readSettings, writeSettings } from "./settings-store.js";
import type { ModelInput } from "./types.js";

async function avatarDataUrl(avatarPath: string | null): Promise<string | null> {
  if (!avatarPath) return null;
  try {
    const extension = path.extname(avatarPath).toLowerCase();
    const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${(await readFile(avatarPath)).toString("base64")}`;
  } catch {
    return null;
  }
}

export async function getPublicSettings() {
  const settings = await readSettings();
  return {
    profile: {
      displayName: settings.profile.displayName,
      avatarDataUrl: await avatarDataUrl(settings.profile.avatarPath),
    },
    models: settings.models.map(({ apiKey, ...model }) => ({ ...model, hasApiKey: Boolean(apiKey) })),
  };
}

export async function saveProfile(displayName: string): Promise<void> {
  const settings = await readSettings();
  settings.profile.displayName = displayName.trim().slice(0, 100);
  await writeSettings(settings);
}

export async function saveModels(inputs: ModelInput[]): Promise<void> {
  const settings = await readSettings();
  const existing = new Map(settings.models.map((model) => [model.id, model]));
  settings.models = inputs.map((input) => ({
    id: input.id,
    name: input.name.trim(),
    baseUrl: input.baseUrl.trim().replace(/\/$/, ""),
    model: input.model.trim(),
    apiKey: input.apiKey?.trim() || existing.get(input.id)?.apiKey || "",
  }));
  await writeSettings(settings);
}

export async function testModel(input: ModelInput) {
  const settings = await readSettings();
  const apiKey = input.apiKey?.trim() || settings.models.find((item) => item.id === input.id)?.apiKey;
  if (!apiKey) return { ok: false, message: "missing_api_key" };
  const started = performance.now();
  try {
    const response = await fetch(`${input.baseUrl.trim().replace(/\/$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return { ok: false, message: `http_${response.status}` };
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, message: "connection_failed" };
  }
}
