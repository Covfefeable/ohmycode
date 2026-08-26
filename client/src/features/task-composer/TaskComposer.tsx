import { useRef, useState } from "react";
import type React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, Square } from "lucide-react";
import { useFeedback } from "../feedback";
import { AttachmentList } from "../../shared/ui/attachment-list";
import { Select } from "../../shared/ui/select";
import styles from "./TaskComposer.module.css";

type TaskComposerProps = {
  disabled?: boolean;
  busy?: boolean;
  models: ModelConfiguration[];
  selectedModelId: string;
  contextUsage?: number;
  onModelChange(modelId: string): void;
  attachments?: MessageAttachment[];
  onRemoveAttachment?(id: string): void;
  onSubmit(content: string, attachments: MessageAttachment[]): Promise<void>;
  onStop(): Promise<void>;
};

export function TaskComposer({ disabled = false, busy = false, models, selectedModelId, contextUsage = 0, attachments = [], onRemoveAttachment, onModelChange, onSubmit, onStop }: TaskComposerProps) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [content, setContent] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  function resize() {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`;
  }
  async function submit() {
    if ((!content.trim() && attachments.length === 0) || disabled || busy) return;
    if (!selectedModelId) {
      toast({ type: "error", message: t("agent.modelRequired") });
      return;
    }
    const next = content;
    setContent("");
    if (textareaRef.current) textareaRef.current.style.height = "auto";
    await onSubmit(next, attachments);
  }
  return (
    <div className={styles.composer}>
      {attachments.length > 0 && <div className={styles.attachments}><AttachmentList attachments={attachments} removeLabel={t("agent.removeAttachment")} onRemove={onRemoveAttachment} /></div>}
      <textarea ref={textareaRef} rows={1} value={content} disabled={disabled || busy} placeholder={t("agent.describeTask")} onChange={(event) => { setContent(event.target.value); resize(); }} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void submit(); } }} />
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Select compact disabled={busy} ariaLabel={t("agent.model")} value={selectedModelId} emptyLabel={t("agent.noModel")} options={models.map((model) => ({ value: model.id, label: model.name || model.model }))} onChange={onModelChange} />
          <span className={styles.sendProgress} style={{ "--context-usage": `${Math.max(0, Math.min(1, contextUsage)) * 100}%` } as React.CSSProperties}>
            <button className={busy ? styles.stop : ""} aria-label={t(busy ? "agent.stop" : "agent.run")} disabled={!busy && ((!content.trim() && attachments.length === 0) || disabled)} onClick={() => void (busy ? onStop() : submit())}>{busy ? <Square /> : <ArrowUp />}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
