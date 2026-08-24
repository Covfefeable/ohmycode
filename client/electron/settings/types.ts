export type StoredModel = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
};

export type StoredSettings = {
  profile: { displayName: string; avatarPath: string | null };
  models: StoredModel[];
};

export type ModelInput = Omit<StoredModel, "apiKey"> & { apiKey?: string; hasApiKey?: boolean };

