import { useState } from "react";
import type { FollowupInput } from "@ohmycode/protocol";
import type React from "react";
import { useTranslation } from "react-i18next";
import { ArrowUp, LoaderCircle, Square, Mic } from "lucide-react";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import { useSpeechInput } from "../speech/useSpeechInput";
import { useSpeech } from "../speech/speech-context";
import { VoiceChatComposer } from "./VoiceChatComposer";
import { useFeedback } from "../feedback";
import { AttachmentList } from "../../shared/ui/attachment-list";
import { Select } from "../../shared/ui/select";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import styles from "./TaskComposer.module.css";

type TaskComposerProps = {
  sessionId?: string;
  disabled?: boolean;
  busy?: boolean;
  models: ModelConfiguration[];
  selectedModelId: string;
  contextUsage?: number;
  onModelChange(modelId: string): void;
  attachments?: MessageAttachment[];
  onRemoveAttachment?(id: string): void;
  onPasteImages?(files: File[]): Promise<void>;
  suggestions?: string[];
  restoredInput?: FollowupInput;
  onSubmit(content: string, attachments: MessageAttachment[]): Promise<boolean | void>;
  onStop(): Promise<void>;
};

export function TaskComposer(props: TaskComposerProps) {
  const speech = useSpeech();
  const [content, setContent] = useState("");
  const [restoredId, setRestoredId] = useState<string>();
  if (props.restoredInput && props.restoredInput.id !== restoredId) {
    setRestoredId(props.restoredInput.id);
    setContent((current) => [current, props.restoredInput?.content].filter(Boolean).join("\n\n"));
  }
  if (speech.settings?.autoPlay) return <VoiceChatComposer
    key={props.sessionId} disabled={props.disabled ?? false} busy={props.busy ?? false}
    selectedModelId={props.selectedModelId} attachments={props.attachments ?? []}
    onSubmit={props.onSubmit} onStop={props.onStop}
  />;
  return <TextTaskComposer {...props} content={content} setContent={setContent} />;
}

function TextTaskComposer({ disabled = false, busy = false, models, selectedModelId, contextUsage = 0, attachments = [], onRemoveAttachment, onPasteImages, suggestions = [], onModelChange, onSubmit, onStop, content, setContent }: TaskComposerProps & { content: string; setContent: React.Dispatch<React.SetStateAction<string>> }) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const microphone = useSpeechInput(content, setContent);
  const [submitting, setSubmitting] = useState(false);
  const [pendingPastes, setPendingPastes] = useState(0);
  const capabilityOptions = usePromptCapabilities();
  async function submit() {
    if (disabled || submitting || pendingPastes > 0 || microphone.state === "starting") return;
    if (!microphone.active && !content.trim() && attachments.length === 0) return;
    if (!selectedModelId) {
      toast({ type: "error", message: t("agent.modelRequired") });
      return;
    }
    setSubmitting(true);
    try {
      const next = microphone.active ? await microphone.finish() : content;
      if (next === null || (!next.trim() && attachments.length === 0)) return;
      const sent = await onSubmit(next, attachments);
      if (sent !== false) setContent((current) => current === next ? "" : current);
    } finally { setSubmitting(false); }
  }
  async function pasteImages(files: File[]) {
    if (!onPasteImages) return;
    setPendingPastes((count) => count + 1);
    try { await onPasteImages(files); }
    catch { toast({ type: "error", message: t("agent.pasteImageFailed") }); }
    finally { setPendingPastes((count) => count - 1); }
  }
  return (
    <div className={styles.composer} onPasteCapture={(event) => {
      if (disabled || !onPasteImages) return;
      const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
      if (!images.length) return;
      event.preventDefault();
      event.stopPropagation();
      void pasteImages(images);
    }}>
      {attachments.length > 0 && <div className={styles.attachments}><AttachmentList attachments={attachments} removeLabel={t("agent.removeAttachment")} onRemove={onRemoveAttachment} /></div>}
      <PromptEditor className={styles.promptEditor} compact submitOnEnter value={content} options={capabilityOptions} disabled={disabled || microphone.active} placeholder={t(microphone.active ? "speech.listening" : "agent.describeTask")} ariaLabel={t("agent.describeTask")} suggestions={busy || microphone.active ? [] : suggestions} onChange={setContent} onSubmit={() => void submit()} />
      <div className={styles.toolbar}>
        <div className={styles.actions}>
          <Select compact disabled={busy} ariaLabel={t("agent.model")} value={selectedModelId} emptyLabel={t("agent.noModel")} options={models.map((model) => ({ value: model.id, label: model.name || model.model }))} onChange={onModelChange} />
          {busy && <button type="button" className={styles.stopButton} aria-label={t("agent.stop")} onClick={() => void onStop()}><Square /></button>}
          <Tooltip content={t(microphone.state === "finishing" ? "speech.finishing" : microphone.active ? "speech.stopInput" : "speech.startInput")}><IconButton active={microphone.active} aria-label={t(microphone.active ? "speech.stopInput" : "speech.startInput")} aria-pressed={microphone.active} disabled={disabled || submitting || microphone.state === "finishing"} onClick={() => void microphone.toggle()}>{microphone.state === "starting" || microphone.state === "finishing" ? <LoaderCircle className={styles.spinner} /> : microphone.active ? <Square /> : <Mic />}</IconButton></Tooltip>
          <span className={styles.sendProgress} style={{ "--context-usage": `${Math.max(0, Math.min(1, contextUsage)) * 100}%` } as React.CSSProperties}>
            <button aria-label={t("agent.run")} aria-busy={submitting || pendingPastes > 0} disabled={submitting || pendingPastes > 0 || microphone.state === "starting" || disabled || (!microphone.active && !content.trim() && attachments.length === 0)} onClick={() => void submit()}>{submitting || pendingPastes > 0 ? <LoaderCircle className={styles.spinner} /> : <ArrowUp />}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
