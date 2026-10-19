import { requestErrorDetails } from "../../shared/lib/request-error";

export function speechErrorKey(error: unknown): string {
  const code =
    requestErrorDetails(error)?.code ??
    (error instanceof Error ? error.message : "");
  if (code === "speech_not_configured") return "speech.notConfigured";
  if (code === "speech_auth_failed") return "speech.authFailed";
  if (code === "speech_rate_limited") return "speech.rateLimited";
  if (code === "speech_voice_invalid") return "speech.voiceInvalid";
  if (code === "speech_voice_not_ready") return "speech.voiceNotReady";
  if (code === "speech_voice_create_failed") return "speech.voiceCreateFailed";
  if (error instanceof DOMException && error.name === "NotAllowedError")
    return "speech.microphoneDenied";
  return "speech.failed";
}
