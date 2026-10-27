import { apiFetch, apiRequest } from "../api/api-client.js";
import type { BackgroundTaskSettings, ModelInput, PublicSettings } from "../../contracts/domain.js";


export async function getPublicSettings(): Promise<PublicSettings> {
  const settings = await apiRequest<PublicSettings>("/api/settings");
  if (settings.profile.avatarAvailable) {
    const response = await apiFetch("/api/settings/avatar");
    if (response.ok) {
      const contentType = response.headers.get("content-type") || "image/png";
      settings.profile.avatarDataUrl = `data:${contentType};base64,${Buffer.from(await response.arrayBuffer()).toString("base64")}`;
    }
  }
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

export function getModels(): Promise<ModelInput[]> {
  return apiRequest("/api/settings/models");
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
