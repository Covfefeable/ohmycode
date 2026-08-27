import { authenticatedRequest } from "@/shared/api/api-client";

export type MobileModelConfiguration = {
  apiKey?: string;
  baseUrl: string;
  contextLength: number;
  hasApiKey?: boolean;
  id: string;
  model: string;
  name: string;
  supportsVision: boolean;
};

export type MobileSettings = {
  models: MobileModelConfiguration[];
  profile: { avatarAvailable: boolean; displayName: string };
};

export function getMobileSettings(): Promise<MobileSettings> {
  return authenticatedRequest("/api/settings");
}

export async function saveMobileProfile(displayName: string): Promise<MobileSettings> {
  await authenticatedRequest<void>("/api/settings/profile", {
    method: "PUT",
    body: JSON.stringify({ displayName }),
  });
  return getMobileSettings();
}

export async function saveMobileModels(models: MobileModelConfiguration[]): Promise<MobileSettings> {
  await authenticatedRequest<void>("/api/settings/models", {
    method: "PUT",
    body: JSON.stringify({ models }),
  });
  return getMobileSettings();
}

export function testMobileModel(model: MobileModelConfiguration): Promise<{ latencyMs?: number; message?: string; ok: boolean }> {
  return authenticatedRequest("/api/settings/models/test", {
    method: "POST",
    body: JSON.stringify(model),
  });
}

export function createMobileModel(): MobileModelConfiguration {
  const id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
  return { id, name: "", baseUrl: "https://api.openai.com/v1", model: "", contextLength: 262_144, supportsVision: false, apiKey: "" };
}
