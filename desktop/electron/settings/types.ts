export type ModelInput = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  hasApiKey?: boolean;
  contextLength: number;
  supportsVision: boolean;
};

export type BackgroundTaskSettings = {
  autoSummaryEnabled: boolean;
  autoSummaryModelId: string | null;
  contextCompactionThreshold: number;
  contextCompactionModelId: string | null;
  suggestionsEnabled: boolean;
  suggestionsModelId: string | null;
};
