import { createContext, useContext } from "react";
import type { SpeechPlayback } from "./speech-playback";
import type { ReadableMessage } from "./speech-text";

export type SpeechContextValue = {
  settings: SpeechSettings | null;
  playing: boolean;
  readingId: string | null;
  recording: boolean;
  setRecording(active: boolean): void;
  playback: SpeechPlayback;
  refresh(): Promise<SpeechSettings>;
  update(settings: SpeechSettings): void;
  toggle(): Promise<void>;
  read(message: ReadableMessage): Promise<void>;
};
export const SpeechContext = createContext<SpeechContextValue | null>(null);
export function useSpeech() {
  const context = useContext(SpeechContext);
  if (!context) throw new Error("SpeechProvider is required");
  return context;
}
