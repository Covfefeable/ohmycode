import { useState } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import { Select } from "../../shared/ui/select";
import { useFeedback } from "../feedback";
import { VoiceCloneDialog } from "./VoiceCloneDialog";
import { useCustomVoices } from "./useCustomVoices";
import styles from "./VoiceField.module.css";

export const DEFAULT_VOICE = "longanhuan_v3.1";
const SYSTEM_VOICES = [
  ["qiaoxiaojiao_v3.1", "speech.voices.qiaoxiaojiao"],
  ["baiqinglan_v3.1", "speech.voices.baiqinglan"],
  ["longanyang_v3.1", "speech.voices.longanyang"],
  ["andi_v3.1", "speech.voices.andi"],
] as const;

export function VoiceField({
  value,
  workspaceId,
  configured,
  canCreate,
  onChange,
}: {
  value: string;
  workspaceId: string;
  configured: boolean;
  canCreate: boolean;
  onChange(value: string): void;
}) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const custom = useCustomVoices(workspaceId, configured);
  return (
    <div className={styles.field}>
      <div className={styles.label}>
        <span>{t("speech.voice")}</span>
        <Tooltip content={t("speech.addVoice")}>
          <IconButton
            aria-label={t("speech.addVoice")}
            onClick={() => {
              if (!canCreate) {
                toast({
                  type: "error",
                  message: t("speech.saveBeforeCloning"),
                });
                return;
              }
              setOpen(true);
            }}
          >
            <Plus />
          </IconButton>
        </Tooltip>
        {(custom.failed ||
          custom.voices.some((voice) => voice.status === "DEPLOYING")) && (
          <Tooltip content={t("speech.refreshVoices")}>
            <IconButton
              disabled={custom.loading}
              aria-label={t("speech.refreshVoices")}
              onClick={() => void custom.refresh()}
            >
              <RefreshCw />
            </IconButton>
          </Tooltip>
        )}
      </div>
      <Select
        value={value}
        ariaLabel={t("speech.voice")}
        options={[
          { value: DEFAULT_VOICE, label: t("speech.defaultVoice") },
          ...SYSTEM_VOICES.map(([voice, label]) => ({ value: voice, label: t(label) })),
          ...custom.voices.map((voice) => ({
            value: voice.voiceId,
            label:
              voice.status === "OK"
                ? voice.name
                : `${voice.name} (${t(voice.status === "DEPLOYING" ? "speech.voicePending" : "speech.voiceRejected")})`,
            disabled: voice.status !== "OK",
          })),
        ]}
        onChange={onChange}
      />
      {custom.failed && (
        <small className={styles.error}>{t("speech.voicesLoadFailed")}</small>
      )}
      {open && (
        <VoiceCloneDialog
          onClose={() => setOpen(false)}
          onCreated={(voice) => {
            custom.added(voice);
          }}
        />
      )}
    </div>
  );
}
