import { useTranslation } from "react-i18next";
import { useVoiceChat } from "../speech/useVoiceChat";
import { VoiceOrb } from "./VoiceOrb";
import styles from "./VoiceChatComposer.module.css";

export function VoiceChatComposer({ disabled, busy, selectedModelId, attachments, onSubmit, onStop }: {
  disabled: boolean; busy: boolean; selectedModelId: string;
  attachments: MessageAttachment[];
  onSubmit(text: string, attachments: MessageAttachment[]): Promise<boolean | void>;
  onStop(): Promise<void>;
}) {
  const { t } = useTranslation();
  const voice = useVoiceChat({ enabled: !disabled && Boolean(selectedModelId), busy, onSubmit: (text) => onSubmit(text, attachments), onStop });
  return <section className={styles.composer} aria-label={t("speech.autoPlay")}>
    <VoiceOrb level={voice.level} waiting={voice.waiting} processing={(voice.sending || busy) && !voice.text} />
  </section>;
}
