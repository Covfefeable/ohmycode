import type { WebContents } from "electron";
import { SpeechService } from "./speech-service.js";

const services = new Map<number, SpeechService>();

export function stopSpeech(): void {
  for (const service of services.values()) service.stop();
}

export function speechForWindow(sender: WebContents): SpeechService {
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
