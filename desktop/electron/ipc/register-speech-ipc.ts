import { ipcMain } from "electron";
import { apiRequest } from "../api/api-client.js";
import { speechForWindow } from "../speech/speech-host.js";
import type {
  SpeechMode,
  SpeechSettings,
  SpeechSettingsInput,
  CustomVoice,
  VoiceCloneInput,
} from "../speech/types.js";

export function registerSpeechIpc() {
  ipcMain.handle("speech:voices", () =>
    apiRequest<CustomVoice[]>("/api/settings/speech/voices"),
  );
  ipcMain.handle("speech:clone-voice", (_event, input: VoiceCloneInput) =>
    apiRequest<CustomVoice>("/api/settings/speech/voices", {
      method: "POST",
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(70000),
    }),
  );
  ipcMain.handle("speech:refresh-voices", () =>
    apiRequest<CustomVoice[]>("/api/settings/speech/voices/refresh", {
      method: "POST",
      signal: AbortSignal.timeout(70000),
    }),
  );
  ipcMain.handle("speech:settings", () =>
    apiRequest<SpeechSettings>("/api/settings/speech"),
  );
  ipcMain.handle("speech:save", (_event, input: SpeechSettingsInput) =>
    apiRequest<SpeechSettings>("/api/settings/speech", {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  );
  ipcMain.handle("speech:auto-play", (_event, enabled: boolean) =>
    apiRequest<SpeechSettings>("/api/settings/speech/auto-play", {
      method: "PUT",
      body: JSON.stringify({ enabled }),
    }),
  );
  ipcMain.handle("speech:start", ({ sender }, id: string, mode: SpeechMode) =>
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
