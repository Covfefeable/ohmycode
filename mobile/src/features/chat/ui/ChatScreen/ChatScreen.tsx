import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/shared/api/api-client";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { MarkdownContent } from "@/shared/ui/MarkdownContent/MarkdownContent";
import { cancelMobileRun, createMobileConversation, getMobileConversation, streamMobileMessage, type MobileMessage } from "../../api/mobile-chat-api";
import { updateMobileActivity, updateStreamingContent } from "../../model/updateMobileActivity";
import { ChatSidebar } from "../ChatSidebar/ChatSidebar";
import { MobileActivityTimeline } from "../MobileActivityTimeline/MobileActivityTimeline";
import { StreamingCursor } from "../StreamingCursor/StreamingCursor";
import { styles } from "./ChatScreen.styles";

type Props = { conversationId: string };

export function ChatScreen({ conversationId }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const listRef = useRef<FlatList<MobileMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const streamingConversationRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState(conversationId);
  const [title, setTitle] = useState(t("chat.newTitle"));
  const [messages, setMessages] = useState<MobileMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(conversationId !== "new");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    setActiveId(conversationId);
    if (streamingConversationRef.current === conversationId) {
      setLoading(false);
      return;
    }
    if (conversationId === "new") {
      setTitle(t("chat.newTitle"));
      setMessages([]);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void getMobileConversation(conversationId)
      .then((conversation) => {
        if (!active) return;
        setTitle(conversation.title);
        setMessages(conversation.messages ?? []);
      })
      .catch(() => { if (active) setError(t("chat.failed")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, t]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setDraft("");
    setError("");
    setSending(true);
    const controller = new AbortController();
    abortRef.current = controller;
    const optimisticUser: MobileMessage = { id: `user-${Date.now()}`, role: "user", content };
    const assistantId = `assistant-${Date.now()}`;
    const agentStartedAt = new Date().toISOString();
    setMessages((current) => [...current, optimisticUser, { id: assistantId, role: "assistant", content: "", activity: [], agentStartedAt }]);
    try {
      let id = activeId;
      if (id === "new") {
        const created = await createMobileConversation(controller.signal);
        id = created.id;
        streamingConversationRef.current = id;
        setActiveId(id);
        router.setParams({ id });
      }
      streamingConversationRef.current = id;
      await streamMobileMessage(id, content, controller.signal, (event) => {
        if (event.type === "run.started") runIdRef.current = event.runId;
        setMessages((current) => current.map((message) => message.id === assistantId ? {
          ...message,
          content: updateStreamingContent(message.content, event),
          activity: updateMobileActivity(message.activity ?? [], event),
        } : message));
      }, (id) => { runIdRef.current = id; });
      const persisted = await getMobileConversation(id);
      setMessages(persisted.messages ?? []);
      setTitle(persisted.title);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      const code = caught instanceof ApiError ? caught.code : "";
      const key = code === "model_not_configured" ? "modelMissing"
        : code.startsWith("provider_http_401") ? "authenticationFailed"
          : code.startsWith("provider_http_403") ? "permissionDenied"
            : code.startsWith("provider_http_429") ? "rateLimited"
              : code.startsWith("provider_http_") ? "providerFailed" : "failed";
      setError(t(`chat.${key}`));
      setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
    } finally {
      streamingConversationRef.current = null;
      abortRef.current = null;
      runIdRef.current = null;
      setSending(false);
    }
  };

  const stop = async () => {
    const partialMessage = [...messages].reverse().find(
      (message) => message.role === "assistant",
    );
    const runId = runIdRef.current;
    abortRef.current?.abort();
    if (runId) {
      await cancelMobileRun(runId, {
        content: partialMessage?.content ?? "",
        activity: partialMessage?.activity ?? [],
      }).catch(() => undefined);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}> 
          <Pressable accessibilityLabel={t("navigation.openSidebar")} onPress={() => setSidebarOpen(true)} style={({ pressed }) => [styles.menu, { backgroundColor: colors.surfaceRaised, borderColor: colors.border, opacity: pressed ? 0.72 : 1 }]}>
            <Feather color={colors.text} name="menu" size={19} />
          </Pressable>
          <Text numberOfLines={1} style={[styles.title, { color: colors.text }]}>{title}</Text>
          <View style={styles.headerSpacer} />
        </View>
        {loading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : (
          <FlatList
            contentContainerStyle={[styles.messages, !messages.length && styles.emptyMessages]}
            data={messages}
            keyExtractor={(item) => item.id}
            onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            ref={listRef}
            renderItem={({ item }) => item.role === "user" ? (
              <View style={[styles.userBubble, { backgroundColor: colors.surfaceRaised }]}><MarkdownContent>{item.content}</MarkdownContent></View>
            ) : (
              <View style={styles.assistantMessage}>
                <MobileActivityTimeline active={sending && item.id.startsWith("assistant-")} durationMs={item.agentDurationMs} finalContent={item.content} startedAt={item.agentStartedAt} steps={item.activity ?? []} />
                {item.content ? <MarkdownContent>{item.content}</MarkdownContent> : null}
                {sending && item.id.startsWith("assistant-") ? <View style={styles.cursorRow}><StreamingCursor /></View> : null}
              </View>
            )}
            ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.textDim }]}>{t("chat.empty")}</Text>}
          />
        )}
        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
        <View style={[styles.composer, { backgroundColor: colors.surface, borderColor: colors.borderStrong }]}>
          <TextInput
            editable={!sending}
            multiline
            onChangeText={setDraft}
            onSubmitEditing={() => void send()}
            placeholder={t("chat.placeholder")}
            placeholderTextColor={colors.textDim}
            selectionColor={colors.accent}
            style={[styles.input, { color: colors.text }]}
            value={draft}
          />
          <Pressable
            accessibilityLabel={sending ? t("chat.stop") : t("chat.send")}
            onPress={sending ? () => void stop() : () => void send()}
            style={({ pressed }) => [styles.send, { backgroundColor: colors.accent, opacity: pressed || (!draft.trim() && !sending) ? 0.55 : 1 }]}
          >
            <Feather color={colors.accentInk} name={sending ? "square" : "arrow-up"} size={18} />
          </Pressable>
        </View>
        <ChatSidebar activeConversationId={activeId} onClose={() => setSidebarOpen(false)} visible={sidebarOpen} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
