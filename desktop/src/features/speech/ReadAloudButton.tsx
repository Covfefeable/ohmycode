import { Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import { useSpeech } from "./speech-context";
import type { ReadableMessage } from "./speech-text";

export function ReadAloudButton({ message }: { message: ReadableMessage }) {
  const { t } = useTranslation();
  const speech = useSpeech();
  const reading = speech.playing && speech.readingId === message.id;
  const label = t(reading ? "speech.stopReading" : "speech.read");
  return <Tooltip content={label}><button
    type="button"
    aria-label={label}
    aria-pressed={reading}
    disabled={speech.recording}
    onClick={() => reading ? speech.playback.stop() : void speech.read(message)}
  >{reading ? <Square /> : <Volume2 />}</button></Tooltip>;
}
