import { handleInvoke } from "./handle-invoke.js";
import { ipcMain } from "electron";
import { apiRequest } from "../api/api-client.js";
import { speechForWindow } from "../speech/speech-host.js";
import type { SpeechMode, SpeechSettings, SpeechSettingsInput, CustomVoice, VoiceCloneInput } from "../../contracts/domain.js";

export function registerSpeechIpc() {
  handleInvoke("speech:voices", () =>
    apiRequest<CustomVoice[]>("/api/settings/speech/voices"),
  );
  handleInvoke("speech:clone-voice", (_event, input: VoiceCloneInput) =>
    apiRequest<CustomVoice>("/api/settings/speech/voices", {
      method: "POST",
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(70000),
    }),
  );
  handleInvoke("speech:refresh-voices", () =>
    apiRequest<CustomVoice[]>("/api/settings/speech/voices/refresh", {
      method: "POST",
      signal: AbortSignal.timeout(70000),
    }),
  );
  handleInvoke("speech:settings", () =>
    apiRequest<SpeechSettings>("/api/settings/speech"),
  );
  handleInvoke("speech:save", (_event, input: SpeechSettingsInput) =>
    apiRequest<SpeechSettings>("/api/settings/speech", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  );
  handleInvoke("speech:auto-play", (_event, enabled: boolean) =>
    apiRequest<SpeechSettings>("/api/settings/speech/auto-play", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  );
  handleInvoke("speech:start", ({ sender }, id: string, mode: SpeechMode) =>
    speechForWindow(sender).start(id, mode),
  );
  ipcMain.on(
    "speech:append",
    ({ sender }, id: string, value: string | Uint8Array) =>
      speechForWindow(sender).append(id, value),
  );
  ipcMain.on("speech:finish", ({ sender }, id: string) =>
    speechForWindow(sender).finish(id),
  );
  ipcMain.on("speech:stop", ({ sender }, mode: SpeechMode) =>
    speechForWindow(sender).stop(mode),
  );
}
