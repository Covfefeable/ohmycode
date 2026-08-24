/// <reference types="vite/client" />

interface Window {
  ohmycode: {
    selectWorkspace(): Promise<string | null>;
    apiStatus(): Promise<{ online: boolean; url: string }>;
    auth: {
      bootstrap(): Promise<
        | { authenticated: false }
        | { authenticated: true; user: AuthUser }
      >;
      login(payload: LoginPayload): Promise<AuthResponse>;
      register(payload: RegistrationPayload): Promise<AuthResponse>;
      logout(): Promise<void>;
    };
    windowControls: {
      minimize(): void;
      toggleMaximize(): void;
      close(): void;
    };
    settings: {
      get(): Promise<PublicSettings>;
      saveProfile(displayName: string): Promise<void>;
      saveModels(models: ModelConfiguration[]): Promise<void>;
      testModel(model: ModelConfiguration): Promise<{ ok: boolean; latencyMs?: number; message?: string }>;
    };
  };
}

type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
};

type LoginPayload = { email: string; password: string };
type RegistrationPayload = LoginPayload & { displayName: string };
type AuthResponse = {
  ok: boolean;
  status: number;
  payload: { user?: AuthUser; error?: { code: string; fields?: Record<string, string> } };
};

type ModelConfiguration = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  hasApiKey?: boolean;
};
type PublicSettings = {
  profile: { displayName: string; avatarDataUrl: string | null };
  models: ModelConfiguration[];
};
