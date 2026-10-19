import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../shared/ui/icon-button";
import { Select } from "../../shared/ui/select";
import { useFeedback } from "../feedback";
import { speechErrorKey } from "../speech/speech-error";
import styles from "./VoiceCloneDialog.module.css";
import { VoiceRecorder } from "./VoiceRecorder";
import { audioBase64 } from "./voice-recording";

const languages = [
  "zh",
  "en",
];

export function VoiceCloneDialog({
  onClose,
  onCreated,
}: {
  onClose(): void;
  onCreated(voice: CustomVoice): void;
}) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const [name, setName] = useState("");
  const [audio, setAudio] = useState<Blob | null>(null);
  const [language, setLanguage] = useState("zh");
  const [preprocess, setPreprocess] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const names = new Intl.DisplayNames([i18n.language], { type: "language" });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector("input")?.focus();
    return () => {
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        if (!busy) onClose();
      }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [busy, onClose]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !name.trim() || !audio || !consent) return;
    setBusy(true);
    setError("");
    try {
      const voice = await window.ohmycode.speech.createVoice({
        name: name.trim(),
        audioData: await audioBase64(audio),
        language,
        preprocess,
        consent,
      });
      onCreated(voice);
      toast({ type: "success", message: t("speech.voiceCreated") });
      onClose();
    } catch (failure) {
      setError(t(speechErrorKey(failure)));
      setBusy(false);
    }
  }

  return createPortal(
    <div
      className={styles.backdrop}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        ref={dialog}
        tabIndex={-1}
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled)",
            ),
          );
          const first = controls[0],
            last = controls.at(-1);
          if (!first) {
            event.preventDefault();
            event.currentTarget.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <header>
          <h2 id={titleId}>{t("speech.addVoice")}</h2>
          <IconButton
            disabled={busy}
            aria-label={t("common.close")}
            onClick={onClose}
          >
            <X />
          </IconButton>
        </header>
        <form onSubmit={(event) => void submit(event)}>
          <div className={styles.fields}>
            <label>
              <span>{t("speech.voiceName")}</span>
              <input
                required
                maxLength={100}
                disabled={busy}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("speech.voiceNamePlaceholder")}
              />
            </label>
            <div className={styles.language}>
              <span>{t("speech.audioLanguage")}</span>
              <Select
                ariaLabel={t("speech.audioLanguage")}
                disabled={busy}
                value={language}
                options={languages.map((value) => ({
                  value,
                  label: names.of(value) ?? value,
                }))}
                onChange={(value) => { setLanguage(value); setAudio(null); }}
              />
            </div>
            <VoiceRecorder key={language} language={language} disabled={busy} onChange={setAudio} />
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                disabled={busy}
                checked={preprocess}
                onChange={(event) => setPreprocess(event.target.checked)}
              />
              <span>{t("speech.preprocess")}</span>
            </label>
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                required
                disabled={busy}
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />
              <span>{t("speech.voiceConsent")}</span>
            </label>
            {error && (
              <p className={styles.error} role="alert">
                {error}
              </p>
            )}
          </div>
          <footer>
            <button type="button" disabled={busy} onClick={onClose}>
              {t("common.cancel")}
            </button>
            <button
              className={styles.primary}
              type="submit"
              disabled={busy || !name.trim() || !audio || !consent}
              aria-busy={busy}
            >
              {busy && <LoaderCircle className={styles.spinner} />}
              {t("speech.createVoice")}
            </button>
          </footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
