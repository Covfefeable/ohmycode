/// <reference types="vite/client" />

interface Window {
  ohmycode: {
    projects: {
      list(): Promise<LocalProject[]>;
      create(): Promise<{ ok: true; project: LocalProject } | { ok: false; reason: "canceled" | "exists" }>;
      open(projectId: string): Promise<void>;
      delete(projectId: string): Promise<void>;
      createConversation(projectId: string, title: string): Promise<LocalConversation>;
      deleteConversation(projectId: string, conversationId: string): Promise<void>;
    };
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
type LocalConversation = { id: string; title: string; createdAt: string };
type LocalProject = { id: string; name: string; path: string; conversations: LocalConversation[] };
