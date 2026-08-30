import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { classifyRequestError } from "../../shared/lib/request-error";
import { updateActivity } from "./activity-timeline/updateActivity";

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
  const activeTurnIdRef = useRef<string | null>(null);
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
        setSuggestions([]);
        suggestionRequestRef.current += 1;
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
      if (event.type !== "turn.completed" && event.type !== "turn.failed" && event.type !== "turn.interrupted") return;
      if (activeTurnIdRef.current === event.turnId) activeTurnIdRef.current = null;
      void window.ohmycode.conversations.waitTurn(event.turnId)
        .then((value) => value ?? window.ohmycode.conversations.get(conversationId))
        .catch(() => window.ohmycode.conversations.get(conversationId))
        .then((value) => {
          if (disposed) return;
          setConversation(value);
          setContextUsage(value.contextUsage && value.contextUsage.contextLength > 0
            ? value.contextUsage.usedTokens / value.contextUsage.contextLength
            : 0);
          setSending(false);
        })
        .catch(() => { if (!disposed) setSending(false); });
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
      setContextUsage(loadedConversation.contextUsage && loadedConversation.contextUsage.contextLength > 0
        ? loadedConversation.contextUsage.usedTokens / loadedConversation.contextUsage.contextLength
        : 0);
      setSuggestions([]);
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
      if (disposed) return;
      setModels(settings.models);
      setSelectedModelId(settings.models[0]?.id ?? "");
    }).catch(() => undefined);
    return () => { disposed = true; unsubscribe(); };
  }, [conversationId, reloadToken, requestErrorMessage, t, toast]);

  async function send(content: string, attachments: MessageAttachment[] = [], editMessageId?: string): Promise<boolean> {
    if (!conversation) return false;
    try {
      const { turnId } = await window.ohmycode.conversations.startTurn(conversationId, content, selectedModelId, editMessageId, attachments);
      activeTurnIdRef.current = turnId;
      const now = new Date().toISOString();
      setConversation((current) => {
        if (!current) return current;
        const streamId = `stream-${turnId}`;
        const currentMessages = (current.messages ?? []).filter((message) => message.id !== streamId);
        const editIndex = editMessageId ? currentMessages.findIndex((message) => message.id === editMessageId) : -1;
        const optimisticMessages = editIndex >= 0
          ? currentMessages.slice(0, editIndex + 1).map((message) => message.id === editMessageId ? { ...message, content } : message)
          : [...currentMessages, { id: `user-${turnId}`, role: "user" as const, content, attachments, createdAt: now }];
        return { ...current, messages: [...optimisticMessages, { id: streamId, role: "assistant", content: "", createdAt: now, agentStartedAt: now, activity: [] }] };
      });
      scrollToBottom();
      setSending(true);
      return true;
    } catch (error) {
      toast({ type: "error", message: requestErrorMessage(error) });
      try { setConversation(await window.ohmycode.conversations.get(conversationId)); } catch { /* Keep the visible snapshot. */ }
      setSending(false);
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
    setSending(false);
    setConversation((current) => current ? {
      ...current,
      messages: (current.messages ?? []).map((message) => message.id === `stream-${turnId}` && stoppedMessage ? stoppedMessage : message),
    } : current);
    await window.ohmycode.conversations.interruptTurn(turnId, stoppedMessage);
  }

  return {
    conversation, loadFailed, sending, models, selectedModelId, contextUsage, suggestions,
    setSelectedModelId, send, stop,
    retry: () => { setLoadFailed(false); setReloadToken((value) => value + 1); },
  };
}
