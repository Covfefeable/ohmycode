import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Pencil } from "lucide-react";
import { TaskComposer } from "../task-composer";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { LoadError } from "../../shared/ui/load-error";
import { Tooltip } from "../../shared/ui/tooltip";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { AttachmentList } from "../../shared/ui/attachment-list";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import { ActivityTimeline } from "./activity-timeline/ActivityTimeline";
import { withoutFinalResponse } from "./activity-timeline/updateActivity";
import { useConversationController } from "./useConversationController";
import styles from "./ConversationChat.module.css";

type ConversationChatProps = { conversationId: string; active: boolean; onUpdated(): void };

export function ConversationChat({ conversationId, active, onUpdated }: ConversationChatProps) {
  const { t, i18n } = useTranslation();
  const capabilityOptions = usePromptCapabilities();
  const [editing, setEditing] = useState<{ message: LocalMessage; content: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const dragDepthRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);

  const forceScrollToBottom = useCallback(() => {
    autoScrollLockedRef.current = true;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.scrollTop = scroller.scrollHeight;
        lastScrollTopRef.current = scroller.scrollTop;
      }
      scrollFrameRef.current = null;
    });
  }, []);

  const controller = useConversationController({ conversationId, onUpdated, scrollToBottom: forceScrollToBottom });
  const { conversation, sending } = controller;
  const conversationLoaded = conversation !== null;
  const lastUserId = useMemo(
    () => [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "user")?.id,
    [conversation],
  );

  useEffect(() => {
    const dock = composerDockRef.current;
    const scroller = scrollRef.current;
    if (!dock || !scroller) return;
    let previousClearance = 0;
    const updateClearance = () => {
      const clearance = Math.ceil(dock.getBoundingClientRect().height) + 54;
      scroller.style.paddingBottom = `${clearance}px`;
      if (autoScrollLockedRef.current && clearance !== previousClearance) scroller.scrollTop = scroller.scrollHeight;
      previousClearance = clearance;
    };
    updateClearance();
    const observer = new ResizeObserver(updateClearance);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [conversation?.id]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || !conversationLoaded) return;
    autoScrollLockedRef.current = true;
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < -1) autoScrollLockedRef.current = false;
    };
    const handleScroll = () => {
      const distanceFromBottom = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      if (scroller.scrollTop < lastScrollTopRef.current - 1 && distanceFromBottom > 36) autoScrollLockedRef.current = false;
      if (distanceFromBottom <= 36) autoScrollLockedRef.current = true;
      lastScrollTopRef.current = scroller.scrollTop;
    };
    scroller.addEventListener("wheel", handleWheel, { passive: true });
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("scroll", handleScroll);
    };
  }, [conversationId, conversationLoaded]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!active || !scroller || !autoScrollLockedRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
      lastScrollTopRef.current = scroller.scrollTop;
      scrollFrameRef.current = null;
    });
    return () => { if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current); };
  }, [active, conversation?.messages]);

  async function copy(message: LocalMessage) {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId((id) => id === message.id ? null : id), 1500);
  }

  async function send(content: string, nextAttachments: MessageAttachment[] = [], editMessageId?: string) {
    const sent = await controller.send(content, nextAttachments, editMessageId);
    if (!sent) return;
    if (editMessageId) setEditing(null);
    else setAttachments([]);
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    const resolved = window.ohmycode.conversations.resolveDroppedFiles(files).filter((item) => item.path);
    setAttachments((current) => {
      const known = new Set(current.map((item) => item.path));
      return [...current, ...resolved.filter((item) => !known.has(item.path))].slice(0, 20);
    });
  }

  if (controller.loadFailed && !conversation) return <LoadError message={t("agent.loadFailed")} onRetry={controller.retry} />;
  if (!conversation) return <FullScreenLoading />;
  return <section
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
    <div ref={scrollRef} className={styles.scrollLayer}><div className={styles.chatInner}>
      <header><h1>{conversation.title}</h1></header>
      <div className={styles.messages}>
      {(conversation.messages ?? []).map((message) => <article key={message.id} className={message.role === "user" ? styles.user : styles.assistant}>
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
          {message.id === lastUserId && !sending && <Tooltip content={t("agent.edit")}><button aria-label={t("agent.edit")} onClick={() => { setEditing({ message, content: message.content }); forceScrollToBottom(); }}><Pencil /></button></Tooltip>}
        </div> : null}
      </article>)}
      {!conversation.messages?.length && <p className={styles.empty}>{t("agent.emptyConversation")}</p>}
      </div>
    </div></div>
    <div ref={composerDockRef} className={styles.composerDock}><TaskComposer busy={sending} disabled={Boolean(editing)} models={controller.models} selectedModelId={controller.selectedModelId} contextUsage={controller.contextUsage} attachments={attachments} suggestions={controller.suggestions} onRemoveAttachment={(id) => setAttachments((items) => items.filter((item) => item.id !== id))} onModelChange={controller.setSelectedModelId} onSubmit={(content, items) => send(content, items)} onStop={controller.stop} /></div>
  </section>;
}
