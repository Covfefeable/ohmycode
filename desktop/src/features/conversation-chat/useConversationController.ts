import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { classifyRequestError } from "../../shared/lib/request-error";
import { updateActivity } from "./activity-timeline/updateActivity";
import { mergeTurnMessages } from "./message-history";

type Options = {
  conversationId: string;
  onUpdated(): void;
  scrollToBottom(): void;
};

export function useConversationController({ conversationId, onUpdated, scrollToBottom }: Options) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [conversation, setConversation] = useState<LocalConversation | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [sending, setSending] = useState(false);
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [contextUsage, setContextUsage] = useState(0);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [prependedCount, setPrependedCount] = useState(0);
  const historyRequestRef = useRef(false);
  const historyGenerationRef = useRef(0);
  const activeTurnIdRef = useRef<string | null>(null);
  const observedTurnsRef = useRef(new Map<string, { status: TurnSnapshot["status"]; initialUserMessageId?: string }>());
  const suggestionRequestRef = useRef(0);
  const conversationRef = useRef<LocalConversation | null>(null);
  const onUpdatedRef = useRef(onUpdated);

  const requestErrorMessage = useCallback((error: unknown) => {
    const kind = classifyRequestError(error);
    if (kind === "model_not_configured") return t("agent.modelRequired");
    if (kind === "authentication_error") return t("agent.authenticationFailed");
    if (kind === "permission_error") return t("agent.permissionDenied");
    if (kind === "rate_limit") return t("agent.rateLimited");
    if (kind === "provider_error") return t("agent.providerFailed");
    if (kind === "network_error") return t("common.networkError");
    return t("agent.sendFailed");
  }, [t]);

  useEffect(() => { conversationRef.current = conversation; }, [conversation]);
  useEffect(() => { onUpdatedRef.current = onUpdated; }, [onUpdated]);
  useEffect(() => window.ohmycode.settings.onModelsChanged((nextModels) => {
    setModels(nextModels);
    setSelectedModelId((current) => nextModels.some((model) => model.id === current)
      ? current
      : nextModels[0]?.id ?? "");
  }), []);

  useEffect(() => {
    let disposed = false;
    historyGenerationRef.current += 1;
    observedTurnsRef.current.clear();
    let snapshotLoaded = false;
    const pending: RuntimeEvent[] = [];
    const handledEvents = new Set<string>();
    let eventFrame: number | null = null;
    let queuedEvents: RuntimeEvent[] = [];
    const applyRuntimeEvents = (events: RuntimeEvent[]) => {
      if (disposed || !events.length) return;
      for (const event of events) {
        if (event.type === "turn.started") {
          observedTurnsRef.current.set(event.turnId, { status: "in_progress" });
          activeTurnIdRef.current = event.turnId;
          setSending(true);
          setSuggestions([]);
          suggestionRequestRef.current += 1;
        }
        const observed = observedTurnsRef.current.get(event.turnId);
        if (observed) {
          if (event.type === "item.completed" && event.item.kind === "user_message" && (event.item.input as { initial?: boolean }).initial) observed.initialUserMessageId = event.item.id;
          if (event.type === "turn.completed") observed.status = "completed";
          if (event.type === "turn.failed") observed.status = "failed";
          if (event.type === "turn.interrupted") observed.status = "interrupted";
        }
        if (event.type === "context.updated") {
          setContextUsage(event.contextLength > 0 ? event.usedTokens / event.contextLength : 0);
        }
      }
      setConversation((current) => {
        if (!current) return current;
        const messages = [...(current.messages ?? [])];
        for (const event of events) {
          if (event.type === "item.completed" && event.item.kind === "user_message") {
            const item = event.item;
            const input = item.input as { attachments: MessageAttachment[]; initial?: boolean };
            const existing = messages.findIndex((message) => message.id === item.id || input.initial && message.id === `user-${event.turnId}`);
            const userMessage: LocalMessage = { id: item.id, role: "user", content: item.content ?? "", attachments: input.attachments, createdAt: new Date().toISOString() };
            if (existing >= 0) messages[existing] = userMessage;
            else {
              const streamIndex = messages.findIndex((message) => message.id === `stream-${event.turnId}`);
              messages.splice(streamIndex < 0 ? messages.length : streamIndex, 0, userMessage);
            }
            continue;
          }
          const streamId = `stream-${event.turnId}`;
          let index = messages.findIndex((message) => message.id === streamId);
          if (index < 0 && (event.type === "turn.started" || event.type.startsWith("item."))) {
            messages.push({ id: streamId, role: "assistant", content: "", createdAt: new Date().toISOString(), agentStartedAt: new Date().toISOString(), activity: [] });
            index = messages.length - 1;
          }
          if (index >= 0) {
            const message = messages[index];
            messages[index] = { ...message, activity: updateActivity(message.activity ?? [], event) };
          }
        }
        return { ...current, messages };
      });
      for (const event of events) {
        if (event.type === "turn.failed") toast({ type: "error", message: requestErrorMessage(event.errorCode) });
        if (event.type !== "turn.completed" && event.type !== "turn.failed" && event.type !== "turn.interrupted") continue;
        if (activeTurnIdRef.current === event.turnId) {
          activeTurnIdRef.current = null;
          setSending(false);
        }
        void window.ohmycode.conversations.waitTurn(event.turnId)
          .then((value) => value ?? window.ohmycode.conversations.history(conversationId, { turnId: event.turnId }))
          .catch(() => window.ohmycode.conversations.history(conversationId, { turnId: event.turnId }))
          .then((value) => {
            if (disposed) return;
            setConversation((current) => current ? { ...current, title: value.title, updatedAt: value.updatedAt,
              messages: mergeTurnMessages(current.messages ?? [], value.messages ?? [], event.turnId),
            } : current);
            if (activeTurnIdRef.current && activeTurnIdRef.current !== event.turnId) return;
            setContextUsage(value.contextUsage && value.contextUsage.contextLength > 0
              ? value.contextUsage.usedTokens / value.contextUsage.contextLength
              : 0);
            setSending(false);
          })
          .catch(() => { if (!disposed && !activeTurnIdRef.current) setSending(false); });
        onUpdatedRef.current();
        if (event.type === "turn.completed") {
          const requestVersion = ++suggestionRequestRef.current;
          void window.ohmycode.conversations.suggest(conversationId)
            .then((value) => {
              if (!disposed && suggestionRequestRef.current === requestVersion && activeTurnIdRef.current === null) {
                setSuggestions(value);
                onUpdatedRef.current();
              }
            })
            .catch(() => undefined);
        }
      }
    };
    const flushRuntimeEvents = () => {
      eventFrame = null;
      const events = queuedEvents;
      queuedEvents = [];
      applyRuntimeEvents(events);
    };
    const enqueueRuntimeEvent = (event: RuntimeEvent) => {
      const eventKey = `${event.turnId}:${event.sequence}`;
      if (disposed || handledEvents.has(eventKey)) return;
      handledEvents.add(eventKey);
      queuedEvents.push(event);
      if (eventFrame === null) eventFrame = window.requestAnimationFrame(flushRuntimeEvents);
    };
    const unsubscribe = window.ohmycode.conversations.onThreadEvent(conversationId, (event) => {
      if (!snapshotLoaded) pending.push(event);
      else enqueueRuntimeEvent(event);
    });
    void Promise.all([
      window.ohmycode.conversations.history(conversationId),
      window.ohmycode.conversations.threadSnapshot(conversationId),
    ]).then(([loadedConversation, snapshot]) => {
      if (disposed) return;
      setConversation(loadedConversation);
      setPrependedCount(0);
      setHistoryLoading(false);
      setHistoryFailed(false);
      setContextUsage(loadedConversation.contextUsage && loadedConversation.contextUsage.contextLength > 0
        ? loadedConversation.contextUsage.usedTokens / loadedConversation.contextUsage.contextLength
        : 0);
      setSuggestions([]);
      activeTurnIdRef.current = snapshot?.status === "in_progress" ? snapshot.turnId : null;
      setSending(activeTurnIdRef.current !== null);
      const replay = snapshot?.status === "in_progress" ? snapshot.events : [];
      for (const event of [...replay, ...pending].sort((left, right) => left.sequence - right.sequence)) enqueueRuntimeEvent(event);
      snapshotLoaded = true;
    }).catch(() => {
      if (disposed) return;
      unsubscribe();
      setLoadFailed(true);
      toast({ type: "error", message: t("agent.loadFailed") });
    });
    void window.ohmycode.settings.listModels().then((models) => {
      if (disposed) return;
      setModels(models);
      setSelectedModelId(models[0]?.id ?? "");
    }).catch(() => undefined);
    return () => {
      disposed = true;
      historyGenerationRef.current += 1;
      unsubscribe();
      if (eventFrame !== null) window.cancelAnimationFrame(eventFrame);
      queuedEvents = [];
    };
  }, [conversationId, reloadToken, requestErrorMessage, t, toast]);

  async function send(content: string, attachments: MessageAttachment[] = [], editMessageId?: string): Promise<boolean> {
    if (!conversation) return false;
    const generation = historyGenerationRef.current;
    try {
      const result = await window.ohmycode.conversations.startTurn(conversationId, content, selectedModelId, editMessageId, attachments);
      if (generation !== historyGenerationRef.current) return true;
      if ("queued" in result) return true;
      const { turnId } = result;
      const observed = observedTurnsRef.current.get(turnId);
      if (observed && observed.status !== "in_progress") return true;
      activeTurnIdRef.current = turnId;
      const now = new Date().toISOString();
      setConversation((current) => {
        if (!current) return current;
        const streamId = `stream-${turnId}`;
        const stream = current.messages?.find((message) => message.id === streamId);
        const currentMessages = (current.messages ?? []).filter((message) => message.id !== streamId);
        const editIndex = editMessageId ? currentMessages.findIndex((message) => message.id === editMessageId) : -1;
        const optimisticMessages = editIndex >= 0
          ? currentMessages.slice(0, editIndex + 1).map((message) => message.id === editMessageId ? { ...message, content } : message)
          : observed?.initialUserMessageId ? currentMessages
          : [...currentMessages, { id: `user-${turnId}`, role: "user" as const, content, attachments, createdAt: now }];
        return { ...current, messages: [...optimisticMessages, stream ?? { id: streamId, role: "assistant", content: "", createdAt: now, agentStartedAt: now, activity: [] }] };
      });
      scrollToBottom();
      setSending(true);
      onUpdatedRef.current();
      return true;
    } catch (error) {
      if (generation !== historyGenerationRef.current) return false;
      toast({ type: "error", message: requestErrorMessage(error) });
      setSending(activeTurnIdRef.current !== null);
      return false;
    }
  }

  async function stop(): Promise<void> {
    const turnId = activeTurnIdRef.current;
    if (!turnId) return;
    const partialMessage = conversationRef.current?.messages?.find((message) => message.id === `stream-${turnId}`);
    const stoppedMessage = partialMessage ? {
      ...partialMessage,
      content: [partialMessage.content, t("agent.stoppedByUser")].filter(Boolean).join("\n\n"),
      activity: partialMessage.activity?.map((step) => ({ ...step, status: "completed" as const })),
    } : undefined;
    try {
      await window.ohmycode.conversations.interruptTurn(turnId, stoppedMessage);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("remote_cancellation_pending")) {
        toast({ type: "error", message: t("agent.stopFailed") });
        return;
      }
      toast({ type: "error", message: t("agent.stopPending") });
    }
    if (activeTurnIdRef.current === turnId) {
      activeTurnIdRef.current = null;
      setSending(false);
    }
    setConversation((current) => current ? {
      ...current,
      messages: (current.messages ?? []).map((message) => message.id === `stream-${turnId}` && stoppedMessage ? stoppedMessage : message),
    } : current);
  }

  async function loadOlder(): Promise<void> {
    const cursor = conversationRef.current?.olderCursor;
    if (!cursor || historyRequestRef.current) return;
    const generation = historyGenerationRef.current;
    historyRequestRef.current = true;
    setHistoryLoading(true);
    setHistoryFailed(false);
    try {
      const page = await window.ohmycode.conversations.history(conversationId, { before: cursor });
      if (generation !== historyGenerationRef.current) return;
      const known = new Set(conversationRef.current?.messages?.map((message) => message.id));
      const older = (page.messages ?? []).filter((message) => !known.has(message.id));
      setPrependedCount((count) => count + older.length);
      setConversation((current) => current ? { ...current, olderCursor: page.olderCursor, messages: [...older, ...(current.messages ?? [])] } : current);
    } catch {
      if (generation === historyGenerationRef.current) setHistoryFailed(true);
    } finally {
      historyRequestRef.current = false;
      if (generation === historyGenerationRef.current) setHistoryLoading(false);
    }
  }

  return {
    conversation, loadFailed, sending, models, selectedModelId, contextUsage, suggestions,
    setSelectedModelId, send, stop,
    historyLoading, historyFailed, prependedCount, loadOlder,
    retry: () => { setLoadFailed(false); setReloadToken((value) => value + 1); },
  };
}
