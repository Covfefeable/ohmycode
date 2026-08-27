import { ArrowUp, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import styles from "./MessageComposer.module.css";

type MessageComposerProps = {
  value: string;
  placeholder: string;
  busy?: boolean;
  onChange(value: string): void;
  onSubmit(): void;
};

export function MessageComposer({ value, placeholder, busy = false, onChange, onSubmit }: MessageComposerProps) {
  const { t } = useTranslation();
  const capabilityOptions = usePromptCapabilities();

  return <div className={styles.composer}>
    <PromptEditor
      compact
      submitOnEnter
      className={styles.promptEditor}
      value={value}
      disabled={busy}
      placeholder={placeholder}
      ariaLabel={placeholder}
      options={capabilityOptions}
      onChange={onChange}
      onSubmit={() => { if (value.trim() && !busy) onSubmit(); }}
    />
    <div className={styles.toolbar}>
      <button aria-label={t("agent.resend")} disabled={busy || !value.trim()} onClick={onSubmit}>
        {busy ? <LoaderCircle className={styles.spinner} /> : <ArrowUp />}
      </button>
    </div>
  </div>;
}
