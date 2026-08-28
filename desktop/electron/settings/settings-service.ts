import { apiFetch, apiRequest } from "../api/api-client.js";
import type { BackgroundTaskSettings, ModelInput } from "./types.js";
import { readLegacySettings, removeLegacySettings } from "./legacy-settings.js";

type PublicSettings = { profile: { displayName: string; avatarAvailable: boolean; avatarDataUrl?: string | null }; models: ModelInput[]; backgroundTasks: BackgroundTaskSettings; tokenUsage: { date: string; tokens: number }[] };

export async function getPublicSettings(): Promise<PublicSettings> {
  let settings = await apiRequest<PublicSettings>("/api/settings");
  if (settings.profile.avatarAvailable) {
    const response = await apiFetch("/api/settings/avatar");
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "image/png";
      settings.profile.avatarDataUrl = `data:${contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    }
  }
  const legacy = await readLegacySettings();
  if (legacy && settings.models.length === 0 && legacy.models.length > 0) {
    await saveModels(legacy.models.map((model) => ({ ...model, contextLength: model.contextLength ?? 262144 })));
    if (!settings.profile.displayName && legacy.profile.displayName) await saveProfile(legacy.profile.displayName);
    settings = await apiRequest<PublicSettings>("/api/settings");
  }
  if (legacy) await removeLegacySettings();
  return settings;
}

export function saveProfile(displayName: string): Promise<void> {
  return apiRequest("/api/settings/profile", { method: "PUT", body: JSON.stringify({ displayName }) });
}

export function saveAvatar(data: string, contentType: string): Promise<void> {
  return apiRequest("/api/settings/avatar", { method: "PUT", body: JSON.stringify({ data, contentType }) });
}

export function saveModels(models: ModelInput[]): Promise<void> {
  return apiRequest("/api/settings/models", { method: "PUT", body: JSON.stringify({ models }) });
}

export function saveBackgroundTasks(settings: BackgroundTaskSettings) {
  return apiRequest<BackgroundTaskSettings>("/api/settings/background-tasks", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export function testModel(model: ModelInput) {
  return apiRequest<{ ok: boolean; latencyMs?: number; message?: string }>("/api/settings/models/test", {
    method: "POST",
    body: JSON.stringify(model),
  });
}
