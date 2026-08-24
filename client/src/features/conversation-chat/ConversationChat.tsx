import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Pencil } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { TaskComposer } from "../task-composer";
import { useFeedback } from "../feedback";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { Tooltip } from "../../shared/ui/tooltip";
import { ActivityTimeline } from "./activity-timeline/ActivityTimeline";
import styles from "./ConversationChat.module.css";

type ConversationChatProps = { conversationId: string; onUpdated(): void };

function updateActivity(steps: AgentActivityStep[], event: ConversationStreamEvent): AgentActivityStep[] {
  const next = steps.map((step) => ({ ...step }));
  if (event.type === "reasoning.started") {
    for (const step of next) if (step.type === "reasoning") step.status = "completed";
    next.push({ id: event.stepId, type: "reasoning", content: "", status: "running" });
  } else if (event.type === "reasoning.delta") {
    const step = [...next].reverse().find((item) => item.type === "reasoning" && item.status === "running");
    if (step?.type === "reasoning") step.content += event.content;
  } else if (event.type === "message.started") {
    for (const step of next) if (step.type === "reasoning") step.status = "completed";
    next.push({ id: `message-${crypto.randomUUID()}`, type: "message", content: "", status: "running" });
  } else if (event.type === "message.delta") {
    const step = [...next].reverse().find((item) => item.type === "message" && item.status === "running");
    if (step?.type === "message") step.content += event.content;
  } else if (event.type === "tool.requested") {
    for (const step of next) if (step.type === "reasoning" || step.type === "message") step.status = "completed";
    next.push({
      id: event.callId,
      type: "tool",
      tool: event.tool,
      input: event.tool === "terminal" ? event.arguments as TerminalAction : JSON.stringify(event.arguments),
      status: "running",
    });
  } else if (event.type === "tool.completed") {
    const step = next.find((item) => item.type === "tool" && item.id === event.callId);
    if (step?.type === "tool") { step.result = event.result; step.status = "completed"; }
  }
  return next;
}

export function ConversationChat({ conversationId, onUpdated }: ConversationChatProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const [conversation, setConversation] = useState<LocalConversation | null>(null);
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [editing, setEditing] = useState<{ message: LocalMessage; content: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollLockedRef = useRef(true);
  const lastScrollTopRef = useRef(0);
  const scrollFrameRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const stoppedRequestIdsRef = useRef(new Set<string>());
  const conversationRef = useRef<LocalConversation | null>(null);

  useEffect(() => { conversationRef.current = conversation; }, [conversation]);

  useEffect(() => {
    void window.ohmycode.conversations.get(conversationId).then(setConversation).catch(() => toast({ type: "error", message: t("agent.loadFailed") }));
    void window.ohmycode.settings.get().then((settings) => {
      setModels(settings.models);
      setSelectedModelId(settings.models[0]?.id ?? "");
    });
  }, [conversationId, t, toast]);

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
    if (!scroller || !autoScrollLockedRef.current) return;
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scroller.scrollTop = scroller.scrollHeight;
      lastScrollTopRef.current = scroller.scrollTop;
      scrollFrameRef.current = null;
    });
    return () => { if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current); };
  }, [conversation?.messages]);

  async function copy(message: LocalMessage) {
    await navigator.clipboard.writeText(message.content);
    setCopiedId(message.id);
    window.setTimeout(() => setCopiedId((id) => id === message.id ? null : id), 1500);
  }

  async function send(content: string, editMessageId?: string) {
    if (!conversation) return;
    const requestId = crypto.randomUUID();
    activeRequestIdRef.current = requestId;
    const now = new Date().toISOString();
    const assistantId = `stream-${requestId}`;
    const currentMessages = conversation.messages ?? [];
    const optimisticMessages = editMessageId
      ? currentMessages.slice(0, currentMessages.findIndex((message) => message.id === editMessageId) + 1).map((message) => message.id === editMessageId ? { ...message, content } : message)
      : [...currentMessages, { id: `user-${requestId}`, role: "user" as const, content, createdAt: now }];
    setConversation({ ...conversation, messages: [...optimisticMessages, { id: assistantId, role: "assistant", content: "", createdAt: now, agentStartedAt: now }] });
    if (editMessageId) setEditing(null);
    setSending(true);
    const queue: ConversationStreamEvent[] = [];
    let draining = false;
    let networkDone = false;
    let resolveDrain: () => void = () => {};
    const drained = new Promise<void>((resolve) => { resolveDrain = resolve; });
    const pump = () => {
      const part = queue.shift();
      if (part) {
        setConversation((current) => current ? { ...current, messages: (current.messages ?? []).map((message) => message.id === assistantId ? {
          ...message,
          activity: updateActivity(message.activity ?? [], part),
        } : message) } : current);
        window.requestAnimationFrame(pump);
        return;
      }
      draining = false;
      if (networkDone) resolveDrain();
    };
    const unsubscribe = window.ohmycode.conversations.onEvent(requestId, (event) => {
      if (event.type === "reasoning.delta" || event.type === "message.delta") {
        const characters = Array.from(event.content);
        for (let index = 0; index < characters.length; index += 4) queue.push({ ...event, content: characters.slice(index, index + 4).join("") });
      } else queue.push(event);
      if (!draining) { draining = true; window.requestAnimationFrame(pump); }
    });
    try {
      const updated = await window.ohmycode.conversations.send(conversationId, content, selectedModelId, requestId, editMessageId);
      networkDone = true;
      if (!draining && queue.length === 0) resolveDrain();
      await drained;
      if (!stoppedRequestIdsRef.current.has(requestId)) setConversation(updated);
      onUpdated();
    } catch {
      if (!stoppedRequestIdsRef.current.has(requestId)) {
        toast({ type: "error", message: t("agent.sendFailed") });
        setConversation(await window.ohmycode.conversations.get(conversationId));
      }
    } finally {
      unsubscribe();
      stoppedRequestIdsRef.current.delete(requestId);
      if (activeRequestIdRef.current === requestId) activeRequestIdRef.current = null;
      setSending(false);
    }
  }

  async function stop() {
    const requestId = activeRequestIdRef.current;
    if (!requestId) return;
    stoppedRequestIdsRef.current.add(requestId);
    const partialMessage = conversationRef.current?.messages?.find((message) => message.id === `stream-${requestId}`);
    const stoppedMessage = partialMessage ? {
      ...partialMessage,
      content: [partialMessage.content, t("agent.stoppedByUser")].filter(Boolean).join("\n\n"),
      activity: partialMessage.activity?.map((step) => ({ ...step, status: "completed" as const })),
    } : undefined;
    setSending(false);
    setConversation((current) => current ? {
      ...current,
      messages: (current.messages ?? []).map((message) => message.id === `stream-${requestId}` && stoppedMessage ? stoppedMessage : message),
    } : current);
    await window.ohmycode.conversations.stop(requestId, stoppedMessage);
  }

  if (!conversation) return <FullScreenLoading />;
  return <section className={styles.chat}>
    <div ref={scrollRef} className={styles.scrollLayer}><div className={styles.chatInner}>
      <header><h1>{conversation.title}</h1></header>
      <div className={styles.messages}>
      {(conversation.messages ?? []).map((message) => <article key={message.id} className={message.role === "user" ? styles.user : styles.assistant}>
        {editing?.message.id === message.id ? <div className={`${styles.bubble} ${styles.editBubble}`}>
          <textarea autoFocus value={editing.content} onChange={(event) => setEditing({ ...editing, content: event.target.value })} />
          <div className={styles.editActions}>
            <button onClick={() => setEditing(null)}>{t("agent.cancel")}</button>
            <button disabled={!editing.content.trim()} onClick={() => void send(editing.content, message.id)}>{t("agent.resend")}</button>
          </div>
        </div> : <>
          {message.role === "assistant" && <ActivityTimeline active={sending && message.id.startsWith("stream-")} durationMs={message.agentDurationMs} startedAt={message.agentStartedAt} steps={message.activity?.length ? message.activity : message.reasoning ? [{ id: `reasoning-${message.id}`, type: "reasoning", content: message.reasoning, status: "completed" }] : []} />}
          {(message.content || !message.activity?.some((step) => step.type === "message")) && <div className={message.role === "assistant" ? styles.response : styles.bubble}><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content || "▍"}</ReactMarkdown></div>}
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
    <div className={styles.composerDock}><TaskComposer busy={sending} disabled={Boolean(editing)} models={models} selectedModelId={selectedModelId} onModelChange={setSelectedModelId} onSubmit={send} onStop={stop} /></div>
  </section>;
}
