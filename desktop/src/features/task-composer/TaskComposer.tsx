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
  const [stopping, setStopping] = useState(false);
  const [pendingPastes, setPendingPastes] = useState(0);
  const capabilityOptions = usePromptCapabilities();
  const hasDraft = Boolean(content.trim()) || attachments.length > 0;
  const finishing = microphone.state === "finishing";
  const processing = submitting || stopping || pendingPastes > 0 || finishing;
  const showStop = stopping || (busy && !hasDraft && !submitting && pendingPastes === 0 && !finishing);
  const actionHint = stopping ? "agent.stopping" : finishing || (submitting && microphone.active) ? "speech.finishing"
    : submitting ? "agent.queueSending"
    : showStop ? "agent.stop" : microphone.active ? busy ? "speech.finishAndQueue" : "speech.finishAndSend"
      : busy ? "agent.enqueueMessage" : "agent.run";
  async function submit() {
    if (disabled || submitting || stopping || pendingPastes > 0 || microphone.state === "starting" || finishing) return;
    if (!hasDraft) return;
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
  async function stop() {
    if (disabled || stopping || submitting) return;
    setStopping(true);
    try { await onStop(); }
    catch { toast({ type: "error", message: t("agent.stopFailed") }); }
    finally { setStopping(false); }
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
          <Tooltip content={t(finishing ? "speech.finishing" : microphone.active ? "speech.stopInput" : "speech.startInput")}><IconButton active={microphone.active} aria-label={t(microphone.active ? "speech.stopInput" : "speech.startInput")} aria-pressed={microphone.active} disabled={disabled || submitting || finishing} onClick={() => void microphone.toggle()}>{microphone.state === "starting" || finishing ? <LoaderCircle className={styles.spinner} /> : <Mic />}</IconButton></Tooltip>
          <Tooltip content={t(actionHint)}><span className={styles.sendProgress} style={{ "--context-usage": `${Math.max(0, Math.min(1, contextUsage)) * 100}%` } as React.CSSProperties}>
            <IconButton className={showStop ? styles.stop : undefined} aria-label={t(showStop ? "agent.stop" : "agent.run")} aria-busy={processing} disabled={disabled || processing || (!showStop && (microphone.state === "starting" || !hasDraft))} onClick={() => void (showStop ? stop() : submit())}>{processing ? <LoaderCircle className={styles.spinner} /> : showStop ? <Square className={styles.stopIcon} /> : <ArrowUp />}</IconButton>
          </span></Tooltip>
        </div>
      </div>
    </div>
  );
}
