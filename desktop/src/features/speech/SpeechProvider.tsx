import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { SpeechContext } from "./speech-context";
import { SpeechPlayback } from "./speech-playback";
import { speechErrorKey } from "./speech-error";
import { messageSpeechText } from "./speech-text";

export function SpeechProvider({ children }: PropsWithChildren) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const [settings, setSettings] = useState<SpeechSettings | null>(null);
  const [playing, setPlaying] = useState(false);
  const [readingId, setReadingId] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [playback] = useState(
    () =>
      new SpeechPlayback(
        (active) => {
          setPlaying(active);
          if (!active) setReadingId(null);
        },
        (error) => {
          toast({ type: "error", message: i18n.t(speechErrorKey(error)) });
        },
      ),
  );
  const refresh = useCallback(async () => {
    const value = await window.ohmycode.speech.getSettings();
    setSettings(value);
    return value;
  }, []);
  useEffect(() => {
    let active = true;
    void window.ohmycode.speech
      .getSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      playback.dispose();
    };
  }, [playback]);
  const value = useMemo(
    () => ({
      settings,
      playing,
      readingId,
      recording,
      setRecording,
      playback,
      refresh,
      update: setSettings,
      async toggle() {
        try {
          const current = settings ?? (await refresh());
          if (!current.hasApiKey) {
            toast({ type: "error", message: t("speech.notConfigured") });
            return;
          }
          if (!current.autoPlay) await playback.unlock();
          else playback.stop();
          setSettings(
            await window.ohmycode.speech.setAutoPlay(!current.autoPlay),
          );
        } catch (error) {
          toast({ type: "error", message: t(speechErrorKey(error)) });
        }
      },
      async read(message: LocalMessage) {
        playback.stop();
        try {
        const current = settings ?? (await refresh());
        if (!current.hasApiKey) throw new Error("speech_not_configured");
          const text = messageSpeechText(message);
          if (!text) return;
          playback.resume();
          await playback.unlock();
          setReadingId(message.id);
          const task = playback.task();
          task.append(text);
          task.finish();
        } catch (error) {
          toast({ type: "error", message: t(speechErrorKey(error)) });
        }
      },
    }),
    [settings, playing, readingId, recording, playback, refresh, t, toast],
  );
  return (
    <SpeechContext.Provider value={value}>{children}</SpeechContext.Provider>
  );
}
