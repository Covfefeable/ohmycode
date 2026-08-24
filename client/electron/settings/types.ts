export type StoredModel = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  contextLength?: number;
};

export type StoredSettings = {
  profile: { displayName: string; avatarPath: string | null };
  models: StoredModel[];
};

export type ModelInput = Omit<StoredModel, "apiKey" | "contextLength"> & {
  apiKey?: string;
  hasApiKey?: boolean;
  contextLength: number;
};
