import { createContext, useContext, useEffect, useMemo, useState, type PropsWithChildren } from "react";

import { authenticate, bootstrapUser } from "@/shared/api/api-client";
import { clearTokens } from "@/shared/api/token-store";
import type { User } from "@/shared/api/types";

type Credentials = { email: string; password: string; displayName?: string };
type AuthContextValue = {
  ready: boolean;
  user: User | null;
  login(credentials: Credentials): Promise<void>;
  register(credentials: Credentials): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    void bootstrapUser()
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setReady(true));
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    ready,
    user,
    login: async (credentials) => setUser((await authenticate("login", credentials)).user),
    register: async (credentials) => setUser((await authenticate("register", credentials)).user),
    logout: async () => {
      await clearTokens();
      setUser(null);
    },
  }), [ready, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("AuthProvider is missing");
  return value;
}
