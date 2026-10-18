import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, GitBranch, LoaderCircle, Pencil } from "lucide-react";
import { TaskComposer } from "../task-composer";
import { useFeedback } from "../feedback";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { LoadError } from "../../shared/ui/load-error";
import { Tooltip } from "../../shared/ui/tooltip";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { AttachmentList } from "../../shared/ui/attachment-list";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import { ActivityTimeline } from "./activity-timeline/ActivityTimeline";
import { withoutFinalResponse } from "./activity-timeline/updateActivity";
import { useConversationController } from "./useConversationController";
import type { FollowupInput } from "@ohmycode/protocol";
import { useFollowupQueue } from "./useFollowupQueue";
import { FollowupStrip } from "./followup-strip/FollowupStrip";
import { classifyRequestError } from "../../shared/lib/request-error";
import styles from "./ConversationChat.module.css";
import type { VirtuosoHandle } from "react-virtuoso";
import { MessageList } from "./message-list/MessageList";
import { ActivityExpansionProvider } from "./activity-timeline/ActivityExpansionProvider";
import { ImageScopeContext } from "../../shared/ui/image-preview/image-scope";

type ConversationChatProps = { conversationId: string; active: boolean; onUpdated(): void; onBranched(conversation: LocalConversation): void };

export function ConversationChat({ conversationId, active, onUpdated, onBranched }: ConversationChatProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const capabilityOptions = usePromptCapabilities();
  const [editing, setEditing] = useState<{ message: LocalMessage; content: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [branchingId, setBranchingId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [restoredInput, setRestoredInput] = useState<FollowupInput>();
  const followups = useFollowupQueue(conversationId);
  const dragDepthRef = useRef(0);
  const listRef = useRef<VirtuosoHandle>(null);
  const [composerClearance, setComposerClearance] = useState(150);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(true);

  const forceScrollToBottom = useCallback(() => {
    autoScrollLockedRef.current = true;
    listRef.current?.scrollToIndex({ index: "LAST", align: "end", offset: composerClearance });
  }, [composerClearance]);

  const controller = useConversationController({ conversationId, onUpdated, scrollToBottom: forceScrollToBottom });
  const { conversation, sending } = controller;
  const lastUserId = useMemo(
    () => [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "user")?.id,
    [conversation],
  );

  useEffect(() => {
    const dock = composerDockRef.current;
    if (!dock) return;
    const updateClearance = () => {
      const clearance = Math.ceil(dock.getBoundingClientRect().height) + 54;
      setComposerClearance(clearance);
    };
    updateClearance();
    const observer = new ResizeObserver(updateClearance);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [conversation?.id]);

  async function copy(message: LocalMessage) {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId((id) => id === message.id ? null : id), 1500);
  }

  async function branch(message: LocalMessage) {
    setBranchingId(message.id);
    try {
      const conversation = await window.ohmycode.conversations.branch(conversationId, message.id);
      onBranched(conversation);
      toast({ type: "success", message: t("agent.branchCreated") });
    } catch {
      toast({ type: "error", message: t("agent.branchFailed") });
    } finally {
      setBranchingId(null);
    }
  }

  async function send(content: string, nextAttachments: MessageAttachment[] = [], editMessageId?: string) {
    const sent = await controller.send(content, nextAttachments, editMessageId);
    if (!sent) return false;
    if (editMessageId) setEditing(null);
    else setAttachments([]);
    return true;
  }

  async function queueAction(action: () => Promise<unknown>) {
    try { await action(); }
    catch (error) { toast({ type: "error", message: t(classifyRequestError(error) === "network_error" ? "common.networkError" : "agent.queueActionFailed") }); }
  }

  async function withdraw(inputId: string) {
    await queueAction(async () => {
      const input = await window.ohmycode.conversations.withdraw(conversationId, inputId);
      setRestoredInput(input);
      setAttachments((current) => [...current, ...input.attachments.filter((item) => !current.some((existing) => existing.path === item.path))]);
    });
  }

  function appendAttachments(resolved: MessageAttachment[]) {
    setAttachments((current) => {
      const known = new Set(current.map((item) => item.path));
      return [...current, ...resolved.filter((item) => !known.has(item.path))].slice(0, 20);
    });
  }

  function addFiles(files: File[]) {
    appendAttachments(window.ohmycode.conversations.resolveDroppedFiles(files).filter((item) => item.path));
  }

  async function pasteImages(files: File[]) {
    for (const file of files.slice(0, Math.max(0, 20 - attachments.length))) {
      const [existing] = window.ohmycode.conversations.resolveDroppedFiles([file]);
      const attachment = existing?.path ? existing : await window.ohmycode.conversations.savePastedImage(new Uint8Array(await file.arrayBuffer()));
      appendAttachments([attachment]);
    }
  }

  if (controller.loadFailed && !conversation) return <LoadError message={t("agent.loadFailed")} onRetry={controller.retry} />;
  if (!conversation) return <FullScreenLoading />;
  return <ImageScopeContext.Provider value={{ conversationId }}><section
    className={`${styles.chat} ${dragActive ? styles.dragActive : ""}`}
    onDragEnter={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      dragDepthRef.current += 1;
      setDragActive(true);
    }}
    onDragOver={(event) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    }}
    onDragLeave={(event) => {
      event.preventDefault();
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) setDragActive(false);
    }}
    onDrop={(event) => {
      event.preventDefault();
      dragDepthRef.current = 0;
      setDragActive(false);
      addFiles(Array.from(event.dataTransfer.files));
    }}
  >
    {dragActive && <div className={styles.dropOverlay}><div><span>＋</span><strong>{t("agent.dropFiles")}</strong><small>{t("agent.dropFilesHint")}</small></div></div>}
    <header className={styles.chatHeader}><h1>{conversation.title}</h1></header>
    <div className={styles.scrollLayer}>
      <ActivityExpansionProvider>
      {conversation.messages?.length ? <MessageList
        messages={conversation.messages}
        prependedCount={controller.prependedCount}
        loading={controller.historyLoading}
        failed={controller.historyFailed}
        loadOlder={controller.loadOlder}
        clearance={composerClearance}
        active={active}
        listRef={listRef}
        followRef={autoScrollLockedRef}
        renderMessage={(message) => <article className={message.role === "user" ? styles.user : styles.assistant}>
        {editing?.message.id === message.id ? <div className={`${styles.bubble} ${styles.editBubble}`}>
          <PromptEditor autoFocus className={styles.editPromptEditor} value={editing.content} options={capabilityOptions} ariaLabel={t("agent.edit")} onChange={(content) => setEditing({ ...editing, content })} />
          <div className={styles.editActions}>
            <button onClick={() => setEditing(null)}>{t("agent.cancel")}</button>
            <button disabled={!editing.content.trim()} onClick={() => void send(editing.content, [], message.id)}>{t("agent.resend")}</button>
          </div>
        </div> : <>
          {message.role === "assistant" && <ActivityTimeline active={sending && message.id.startsWith("stream-")} durationMs={message.agentDurationMs} startedAt={message.agentStartedAt} steps={message.activity?.length ? withoutFinalResponse(message.activity, message.content) : message.reasoning ? [{ id: `reasoning-${message.id}`, type: "reasoning", content: message.reasoning, status: "completed" }] : []} />}
          {message.attachments?.length ? <div className={styles.messageAttachments}><AttachmentList attachments={message.attachments} /></div> : null}
          {(message.content || (message.role === "assistant" && !message.activity?.some((step) => step.type === "message"))) && <div className={message.role === "assistant" ? styles.response : styles.bubble}><MarkdownContent>{message.content || "▍"}</MarkdownContent></div>}
        </>}
        {!editing || editing.message.id !== message.id ? <div className={styles.messageActions}>
          <time>{new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time>
          <Tooltip content={t("agent.copy")}><button aria-label={t("agent.copy")} onClick={() => void copy(message)}>{copiedId === message.id ? <Check /> : <Copy />}</button></Tooltip>
          {!message.id.startsWith("stream-") && !message.id.startsWith("user-") && <Tooltip content={t("agent.branch")}><button aria-label={t("agent.branch")} disabled={branchingId !== null} onClick={() => void branch(message)}>{branchingId === message.id ? <LoaderCircle className={styles.spin} /> : <GitBranch />}</button></Tooltip>}
          {message.id === lastUserId && !sending && <Tooltip content={t("agent.edit")}><button aria-label={t("agent.edit")} onClick={() => { setEditing({ message, content: message.content }); forceScrollToBottom(); }}><Pencil /></button></Tooltip>}
        </div> : null}
      </article>} /> : <p className={styles.empty}>{t("agent.emptyConversation")}</p>}
      </ActivityExpansionProvider>
    </div>
    <div ref={composerDockRef} className={styles.composerDock}>
      <FollowupStrip state={followups} running={sending} onSteer={(id) => void queueAction(() => window.ohmycode.conversations.steer(conversationId, id))} onWithdraw={(id) => void withdraw(id)} onResume={() => void queueAction(() => window.ohmycode.conversations.resumeQueue(conversationId))} />
      <TaskComposer onPasteImages={pasteImages} busy={sending} disabled={Boolean(editing)} models={controller.models} selectedModelId={controller.selectedModelId} contextUsage={controller.contextUsage} attachments={attachments} suggestions={controller.suggestions} restoredInput={restoredInput} onRemoveAttachment={(id) => setAttachments((items) => items.filter((item) => item.id !== id))} onModelChange={controller.setSelectedModelId} onSubmit={(content, items) => send(content, items)} onStop={controller.stop} />
    </div>
  </section></ImageScopeContext.Provider>;
}
