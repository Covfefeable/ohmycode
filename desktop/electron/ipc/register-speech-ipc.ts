import { ipcMain, type WebContents } from "electron";
import { apiRequest } from "../api/api-client.js";
import { SpeechService } from "../speech/speech-service.js";
import type {
  SpeechMode,
  SpeechSettings,
  SpeechSettingsInput,
  CustomVoice,
  VoiceCloneInput,
} from "../speech/types.js";

const services = new Map<number, SpeechService>();

export function stopSpeech() {
  for (const service of services.values()) service.stop();
}

function service(sender: WebContents) {
  let current = services.get(sender.id);
  if (!current) {
    current = new SpeechService((id, event) => {
      if (!sender.isDestroyed()) sender.send(`speech:event:${id}`, event);
    });
    services.set(sender.id, current);
    sender.once("destroyed", () => {
      services.get(sender.id)?.stop();
      services.delete(sender.id);
    });
  }
  return current;
}

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
    service(sender).start(id, mode),
  );
  ipcMain.on(
    "speech:append",
    ({ sender }, id: string, value: string | Uint8Array) =>
      service(sender).append(id, value),
  );
  ipcMain.on("speech:finish", ({ sender }, id: string) =>
    service(sender).finish(id),
  );
  ipcMain.on("speech:stop", ({ sender }, mode: SpeechMode) =>
    service(sender).stop(mode),
  );
}
