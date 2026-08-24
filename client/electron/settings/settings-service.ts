import { apiRequest } from "../api/api-client.js";
import type { ModelInput } from "./types.js";
import { readLegacySettings, removeLegacySettings } from "./legacy-settings.js";

type PublicSettings = { profile: { displayName: string; avatarDataUrl: string | null }; models: ModelInput[] };

export async function getPublicSettings(): Promise<PublicSettings> {
  let settings = await apiRequest<PublicSettings>("/api/settings");
  const legacy = await readLegacySettings();
  if (legacy && settings.models.length === 0 && legacy.models.length > 0) {
    await saveModels(legacy.models);
    if (!settings.profile.displayName && legacy.profile.displayName) await saveProfile(legacy.profile.displayName);
    settings = await apiRequest<PublicSettings>("/api/settings");
  }
  if (legacy) await removeLegacySettings();
  return settings;
}

export function saveProfile(displayName: string): Promise<void> {
  return apiRequest("/api/settings/profile", { method: "PUT", body: JSON.stringify({ displayName }) });
}

export function saveModels(models: ModelInput[]): Promise<void> {
  return apiRequest("/api/settings/models", { method: "PUT", body: JSON.stringify({ models }) });
}

export function testModel(model: ModelInput) {
  return apiRequest<{ ok: boolean; latencyMs?: number; message?: string }>("/api/settings/models/test", {
    method: "POST",
    body: JSON.stringify(model),
  });
}
