import { useRef } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`;
  }

  return <div className={styles.composer}>
    <textarea
      ref={textareaRef}
      rows={1}
      value={value}
      disabled={busy}
      placeholder={placeholder}
      onChange={(event) => { onChange(event.target.value); resize(); }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          if (value.trim() && !busy) onSubmit();
        }
      }}
    />
    <div className={styles.toolbar}>
      <button aria-label={t("agent.resend")} disabled={busy || !value.trim()} onClick={onSubmit}>
        {busy ? <LoaderCircle className={styles.spinner} /> : <ArrowUp />}
      </button>
    </div>
  </div>;
}
