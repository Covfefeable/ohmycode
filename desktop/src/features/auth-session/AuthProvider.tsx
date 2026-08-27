import { type PropsWithChildren, useEffect, useMemo, useState } from "react";
import type { User } from "../../entities/user";
import {
  AuthContext,
  type AuthContextValue,
  type AuthResult,
  type AuthStatus,
} from "./auth-context";

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>("booting");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let active = true;
    let retryTimer: number | undefined;

    const bootstrap = async () => {
      try {
        const result = await window.ohmycode.auth.bootstrap();
        if (!active) return;
        if (result.authenticated) {
          setUser(result.user);
          setStatus("authenticated");
        } else {
          setUser(null);
          setStatus("guest");
        }
      } catch {
        if (!active) return;
        setStatus("unavailable");
        retryTimer = window.setTimeout(bootstrap, 5000);
      }
    };

    void bootstrap();
    return () => {
      active = false;
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, []);

  async function authenticate(
    action: "login" | "register",
    payload: LoginPayload | RegistrationPayload,
  ): Promise<AuthResult> {
    try {
      const result = await window.ohmycode.auth[action](payload as RegistrationPayload);
      if (!result.ok || !result.payload.user) {
        return {
          ok: false,
          code: result.payload.error?.code ?? "request_failed",
          fields: result.payload.error?.fields,
        };
      }
      setUser(result.payload.user);
      setStatus("authenticated");
      return { ok: true };
    } catch {
      return { ok: false, code: "service_unavailable" };
    }
  }

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login: (email, password) => authenticate("login", { email, password }),
      register: (displayName, email, password) =>
        authenticate("register", { displayName, email, password }),
      logout: async () => {
        await window.ohmycode.auth.logout();
        setUser(null);
        setStatus("guest");
      },
    }),
    [status, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
