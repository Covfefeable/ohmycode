export type SpeechSettings = {
  workspaceId: string;
  voice: string;
  autoPlay: boolean;
  hasApiKey: boolean;
};
export type SpeechSettingsInput = Pick<
  SpeechSettings,
  "workspaceId" | "voice"
> & { apiKey?: string };
export type SpeechMode = "asr" | "tts";
export type CustomVoice = {
  id: string;
  voiceId: string;
  name: string;
  status: "DEPLOYING" | "OK" | "UNDEPLOYED";
};
export type VoiceCloneInput = {
  name: string;
  audioUrl: string;
  language: string;
  preprocess: boolean;
  consent: boolean;
};
export type SpeechEvent =
  | { type: "audio"; data: Uint8Array }
  | { type: "transcript"; sentenceId: number; text: string; final: boolean }
  | { type: "finished" }
  | { type: "error"; code: string };
export type SpeechConnection = { url: string; apiKey: string; voice: string };
