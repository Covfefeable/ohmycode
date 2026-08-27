import { createContext } from "react";
import type { User } from "../../entities/user";

export type AuthStatus = "booting" | "authenticated" | "guest" | "unavailable";
export type AuthResult =
  | { ok: true }
  | { ok: false; code: string; fields?: Record<string, string> };

export type AuthContextValue = {
  status: AuthStatus;
  user: User | null;
  login(email: string, password: string): Promise<AuthResult>;
  register(displayName: string, email: string, password: string): Promise<AuthResult>;
  logout(): Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | null>(null);

