import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { LoadError } from "../../shared/ui/load-error";
import { useFeedback } from "../feedback";
import { useSpeech } from "../speech/speech-context";
import styles from "./SpeechSettingsPanel.module.css";
import { VoiceField, DEFAULT_VOICE } from "./VoiceField";

export function SpeechSettingsPanel() {
  const { t } = useTranslation();
  const { settings, refresh } = useSpeech();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void refresh().catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [refresh, attempt]);
  if (!settings && failed)
    return (
      <LoadError
        message={t("settings.loadFailed")}
        onRetry={() => {
          setFailed(false);
          setAttempt((value) => value + 1);
        }}
      />
    );
  if (!settings) return <FullScreenLoading />;
  return <SpeechSettingsForm initial={settings} />;
}

function SpeechSettingsForm({ initial }: { initial: SpeechSettings }) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const { update } = useSpeech();
  const [workspaceId, setWorkspaceId] = useState(initial.workspaceId);
  const [voice, setVoice] = useState(initial.voice);
  const [apiKey, setApiKey] = useState("");
  const [hasApiKey, setHasApiKey] = useState(initial.hasApiKey);
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      const saved = await window.ohmycode.speech.saveSettings({
        workspaceId,
        voice,
        apiKey,
      });
      setApiKey("");
      setHasApiKey(saved.hasApiKey);
      update(saved);
      toast({ type: "success", message: t("speech.saved") });
    } catch {
      toast({ type: "error", message: t("settings.saveFailed") });
    } finally {
      setSaving(false);
    }
  }
  return (
    <section className={styles.section}>
      <SettingsSectionHeader
        title={t("speech.title")}
        description={t("speech.description")}
        actions={
          <button
            className={styles.save}
            disabled={
              saving ||
              !workspaceId.trim() ||
              !voice.trim() ||
              (!hasApiKey && !apiKey.trim())
            }
            onClick={() => void save()}
          >
            {saving && <LoaderCircle className={styles.spinner} />}
            {t("speech.save")}
          </button>
        }
      />
      <div className={styles.card}>
        <label>
          <span>{t("speech.workspace")}</span>
          <input
            value={workspaceId}
            placeholder="llm-…"
            autoComplete="off"
            onChange={(event) => {
              setWorkspaceId(event.target.value);
              setVoice(DEFAULT_VOICE);
            }}
          />
        </label>
        <label>
          <span>{t("settings.apiKey")}</span>
          <input
            type="password"
            value={apiKey}
            autoComplete="new-password"
            placeholder={t(
              hasApiKey ? "speech.keySaved" : "speech.keyPlaceholder",
            )}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <VoiceField
          value={voice}
          workspaceId={initial.workspaceId}
          configured={hasApiKey && workspaceId === initial.workspaceId}
          canCreate={
            hasApiKey && workspaceId === initial.workspaceId && !apiKey.trim()
          }
          onChange={setVoice}
        />
      </div>
    </section>
  );
}
