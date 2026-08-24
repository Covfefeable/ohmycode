import { ipcMain } from "electron";
import { authenticate, bootstrapAuth, clearTokens } from "../auth/auth-service.js";
import type { AuthPayload } from "../auth/types.js";

export function registerAuthIpc(): void {
  ipcMain.handle("auth:bootstrap", bootstrapAuth);
  ipcMain.handle("auth:login", (_event, payload: AuthPayload) => authenticate("/login", payload));
  ipcMain.handle("auth:register", (_event, payload: AuthPayload) =>
    authenticate("/register", payload),
  );
  ipcMain.handle("auth:logout", clearTokens);
}

