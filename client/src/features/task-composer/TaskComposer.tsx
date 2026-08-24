import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, ChevronDown, LoaderCircle } from "lucide-react";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./TaskComposer.module.css";

type TaskComposerProps = {
  disabled?: boolean;
  busy?: boolean;
  models: ModelConfiguration[];
  selectedModelId: string;
  onModelChange(modelId: string): void;
  onSubmit(content: string): Promise<void>;
};

export function TaskComposer({ disabled = false, busy = false, models, selectedModelId, onModelChange, onSubmit }: TaskComposerProps) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`;
  }
  async function submit() {
    if (!content.trim() || disabled || busy) return;
    const next = content;
    setContent("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await onSubmit(next);
  }
  return (
    <div className={styles.composer}>
      <textarea ref={textareaRef} rows={1} value={content} disabled={disabled || busy} placeholder={t("agent.describeTask")} onChange={(event) => { setContent(event.target.value); resize(); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Tooltip content={models.length === 0 ? t("agent.noModelHint") : t("agent.model")}><span className={`${styles.modelSelect} ${models.length === 0 ? styles.missingModel : ""}`}>
            <select aria-label={t("agent.model")} value={selectedModelId} disabled={busy || models.length === 0} onChange={(event) => onModelChange(event.target.value)}>
              {models.length === 0 && <option value="">{t("agent.noModel")}</option>}
              {models.map((model) => <option key={model.id} value={model.id}>{model.name || model.model}</option>)}
            </select>
            <ChevronDown />
          </span></Tooltip>
          <button aria-label={t("agent.run")} disabled={!content.trim() || disabled || busy || !selectedModelId} onClick={() => void submit()}>{busy ? <LoaderCircle className={styles.spinner} /> : <ArrowUp />}</button>
        </div>
      </div>
    </div>
  );
}
