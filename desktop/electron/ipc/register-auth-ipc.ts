import { handleInvoke } from "./handle-invoke.js";
import { authenticate, bootstrapAuth, clearTokens } from "../auth/auth-service.js";
import type { AuthPayload } from "../auth/types.js";
import { stopSpeech } from "../speech/speech-host.js";
import { closeBrowsers } from "../browser/browser-service.js";

export function registerAuthIpc(): void {
  handleInvoke("auth:bootstrap", bootstrapAuth);
  handleInvoke("auth:login", (_event, payload: AuthPayload) => authenticate("/login", payload));
  handleInvoke("auth:register", (_event, payload: AuthPayload) =>
    authenticate("/register", payload),
  );
  handleInvoke("auth:logout", () => { stopSpeech(); closeBrowsers(); return clearTokens(); });
}

