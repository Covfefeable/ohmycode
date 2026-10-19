import { useEffect, useRef } from "react";
import { Mic, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { speechErrorKey } from "../speech/speech-error";
import { useSpeech } from "../speech/speech-context";
import { useVoiceRecording } from "./useVoiceRecording";
import styles from "./VoiceRecorder.module.css";

export function VoiceRecorder({ language, disabled, onChange }: {
  language: string; disabled: boolean; onChange(audio: Blob | null): void;
}) {
  const { t } = useTranslation();
  const recording = useVoiceRecording();
  const { playback, setRecording } = useSpeech();
  const player = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    onChange(recording.seconds >= 10 ? recording.audio : null);
  }, [recording.audio, recording.seconds, onChange]);
  useEffect(() => {
    if (!recording.audio) return;
    const url = URL.createObjectURL(recording.audio);
    if (player.current) player.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [recording.audio]);
  const active = recording.state !== "idle";
  useEffect(() => {
    if (!active) return;
    playback.stop();
    setRecording(true);
    return () => setRecording(false);
  }, [active, playback, setRecording]);
  return <div className={styles.recorder}>
    <p className={styles.sample}>{t(language === "en" ? "speech.sampleEnglish" : "speech.sampleChinese")}</p>
    <small>{t("speech.recordingHelp")}</small>
    <div className={styles.controls}>
      <button type="button" disabled={disabled || recording.state === "starting" || recording.state === "finishing"}
        onClick={() => active ? recording.stop() : void recording.start()}>
        {active ? <Square /> : <Mic />}
        {t(active ? "speech.stopRecording" : recording.audio ? "speech.recordAgain" : "speech.recordVoice")}
      </button>
      <span aria-live="polite">{t("speech.recordedSeconds", { seconds: Math.floor(recording.seconds) })}</span>
      {active && <meter min={0} max={1} value={recording.level} aria-label={t("speech.recordingLevel")} />}
    </div>
    {recording.audio && <audio ref={player} controls aria-label={t("speech.recordingPreview")} />}
    {recording.audio && recording.seconds < 10 && <small role="alert">{t("speech.recordingTooShort")}</small>}
    {recording.error != null && <small role="alert">{t(speechErrorKey(recording.error))}</small>}
  </div>;
}
