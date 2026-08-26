import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Pencil } from "lucide-react";
import { TaskComposer } from "../task-composer";
import { useFeedback } from "../feedback";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { LoadError } from "../../shared/ui/load-error";
import { Tooltip } from "../../shared/ui/tooltip";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { AttachmentList } from "../../shared/ui/attachment-list";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import { classifyRequestError } from "../../shared/lib/request-error";
import { ActivityTimeline } from "./activity-timeline/ActivityTimeline";
import { withoutFinalResponse } from "./activity-timeline/updateActivity";
import { updateActivity } from "./activity-timeline/updateActivity";
import styles from "./ConversationChat.module.css";

type ConversationChatProps = { conversationId: string; active: boolean; onUpdated(): void };

export function ConversationChat({ conversationId, active, onUpdated }: ConversationChatProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const capabilityOptions = usePromptCapabilities();
  const [conversation, setConversation] = useState<LocalConversation | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [editing, setEditing] = useState<{ message: LocalMessage; content: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [contextUsage, setContextUsage] = useState(0);
  const dragDepthRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const composerDockRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const activeTurnIdRef = useRef<string | null>(null);
  const conversationRef = useRef<LocalConversation | null>(null);
  const onUpdatedRef = useRef(onUpdated);
  const requestErrorMessage = useCallback((error: unknown) => {
    const kind = classifyRequestError(error);
    if (kind === "model_not_configured") return t("agent.modelRequired");
    if (kind === "network_error") return t("common.networkError");
    return t("agent.sendFailed");
  }, [t]);

  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => { onUpdatedRef.current = onUpdated; }, [onUpdated]);
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
    let disposed = false;
    let snapshotLoaded = false;
    const pending: RuntimeEvent[] = [];
    const handledEvents = new Set<string>();
    const applyRuntimeEvent = (event: RuntimeEvent) => {
      const eventKey = `${event.turnId}:${event.sequence}`;
      if (disposed || handledEvents.has(eventKey)) return;
      handledEvents.add(eventKey);
      if (event.type === "turn.started") {
        activeTurnIdRef.current = event.turnId;
        setSending(true);
      }
      if (event.type === "context.updated") {
        setContextUsage(event.contextLength > 0 ? event.usedTokens / event.contextLength : 0);
      }
      setConversation((current) => {
        if (!current) return current;
        const streamId = `stream-${event.turnId}`;
        const messages = [...(current.messages ?? [])];
        let index = messages.findIndex((message) => message.id === streamId);
        if (index < 0 && (event.type === "turn.started" || event.type.startsWith("item."))) {
          messages.push({ id: streamId, role: "assistant", content: "", createdAt: new Date().toISOString(), agentStartedAt: new Date().toISOString(), activity: [] });
          index = messages.length - 1;
        }
        if (index >= 0) {
          const message = messages[index];
          messages[index] = { ...message, activity: updateActivity(message.activity ?? [], event) };
        }
        return { ...current, messages };
      });
      if (event.type === "turn.failed") toast({ type: "error", message: requestErrorMessage(event.errorCode) });
      if (event.type === "turn.completed" || event.type === "turn.failed" || event.type === "turn.interrupted") {
        if (activeTurnIdRef.current === event.turnId) activeTurnIdRef.current = null;
        void window.ohmycode.conversations.waitTurn(event.turnId)
          .then((value) => value ?? window.ohmycode.conversations.get(conversationId))
          .catch(() => window.ohmycode.conversations.get(conversationId))
          .then((value) => {
            if (disposed) return;
            setConversation(value);
            setSending(false);
          })
          .catch(() => {
            if (!disposed) setSending(false);
          });
        onUpdatedRef.current();
      }
    };
    const unsubscribe = window.ohmycode.conversations.onThreadEvent(conversationId, (event) => {
      if (!snapshotLoaded) pending.push(event);
      else applyRuntimeEvent(event);
    });
    void Promise.all([
      window.ohmycode.conversations.get(conversationId),
      window.ohmycode.conversations.threadSnapshot(conversationId),
    ]).then(([loadedConversation, snapshot]) => {
      if (disposed) return;
      setConversation(loadedConversation);
      if (snapshot?.status === "in_progress") {
        activeTurnIdRef.current = snapshot.turnId;
        setSending(true);
      }
      const replay = snapshot?.status === "in_progress" ? snapshot.events : [];
      for (const event of [...replay, ...pending].sort((left, right) => left.sequence - right.sequence)) applyRuntimeEvent(event);
      snapshotLoaded = true;
    }).catch(() => {
      if (disposed) return;
      unsubscribe();
      setLoadFailed(true);
      toast({ type: "error", message: t("agent.loadFailed") });
    });
    void window.ohmycode.settings.get().then((settings) => {
      setModels(settings.models);
      setSelectedModelId(settings.models[0]?.id ?? "");
    });
    return () => { disposed = true; unsubscribe(); };
  }, [conversationId, reloadToken, requestErrorMessage, t, toast]);

  const lastUserId = useMemo(() => [...(conversation?.messages ?? [])].reverse().find((message) => message.role === "user")?.id, [conversation]);
  const conversationLoaded = conversation !== null;
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
    if (!conversation) return;
    try {
      const { turnId } = await window.ohmycode.conversations.startTurn(conversationId, content, selectedModelId, editMessageId, nextAttachments);
      activeTurnIdRef.current = turnId;
      const now = new Date().toISOString();
      setConversation((current) => {
        if (!current) return current;
        const streamId = `stream-${turnId}`;
        const existingStream = (current.messages ?? []).find((message) => message.id === streamId);
        const currentMessages = (current.messages ?? []).filter((message) => message.id !== streamId);
        const optimisticMessages = editMessageId
          ? currentMessages.slice(0, currentMessages.findIndex((message) => message.id === editMessageId) + 1).map((message) => message.id === editMessageId ? { ...message, content } : message)
          : [...currentMessages, { id: `user-${turnId}`, role: "user" as const, content, attachments: nextAttachments, createdAt: now }];
        return { ...current, messages: [...optimisticMessages, existingStream ?? { id: streamId, role: "assistant", content: "", createdAt: now, agentStartedAt: now, activity: [] }] };
      });
      if (editMessageId) setEditing(null);
      else setAttachments([]);
      setSending(true);
    } catch (error) {
      toast({ type: "error", message: requestErrorMessage(error) });
      setConversation(await window.ohmycode.conversations.get(conversationId));
      setSending(false);
    }
  }

  async function stop() {
    const turnId = activeTurnIdRef.current;
    if (!turnId) return;
    const partialMessage = conversationRef.current?.messages?.find((message) => message.id === `stream-${turnId}`);
    const stoppedMessage = partialMessage ? {
      ...partialMessage,
      content: [partialMessage.content, t("agent.stoppedByUser")].filter(Boolean).join("\n\n"),
      activity: partialMessage.activity?.map((step) => ({ ...step, status: "completed" as const })),
    } : undefined;
    setSending(false);
    setConversation((current) => current ? {
      ...current,
      messages: (current.messages ?? []).map((message) => message.id === `stream-${turnId}` && stoppedMessage ? stoppedMessage : message),
    } : current);
    await window.ohmycode.conversations.interruptTurn(turnId, stoppedMessage);
  }

  function addFiles(files: File[]) {
    if (!files.length) return;
    const resolved = window.ohmycode.conversations.resolveDroppedFiles(files).filter((item) => item.path);
    setAttachments((current) => {
      const known = new Set(current.map((item) => item.path));
      return [...current, ...resolved.filter((item) => !known.has(item.path))].slice(0, 20);
    });
  }

  if (loadFailed && !conversation) return <LoadError message={t("agent.loadFailed")} onRetry={() => { setLoadFailed(false); setReloadToken((value) => value + 1); }} />;
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
          {message.id === lastUserId && !sending && <Tooltip content={t("agent.edit")}><button aria-label={t("agent.edit")} onClick={() => setEditing({ message, content: message.content })}><Pencil /></button></Tooltip>}
        </div> : null}
      </article>)}
      {!conversation.messages?.length && <p className={styles.empty}>{t("agent.emptyConversation")}</p>}
      </div>
    </div></div>
    <div ref={composerDockRef} className={styles.composerDock}><TaskComposer busy={sending} disabled={Boolean(editing)} models={models} selectedModelId={selectedModelId} contextUsage={contextUsage} attachments={attachments} onRemoveAttachment={(id) => setAttachments((items) => items.filter((item) => item.id !== id))} onModelChange={setSelectedModelId} onSubmit={(content, items) => send(content, items)} onStop={stop} /></div>
  </section>;
}
