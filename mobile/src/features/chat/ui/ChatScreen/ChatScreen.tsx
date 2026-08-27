import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ApiError } from "@/shared/api/api-client";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { cancelMobileRun, createMobileConversation, getMobileConversation, streamMobileMessage, type MobileMessage } from "../../api/mobile-chat-api";
import { styles } from "./ChatScreen.styles";

type Props = { conversationId: string };

export function ChatScreen({ conversationId }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const listRef = useRef<FlatList<MobileMessage>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const [activeId, setActiveId] = useState(conversationId);
  const [title, setTitle] = useState(t("chat.newTitle"));
  const [messages, setMessages] = useState<MobileMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(conversationId !== "new");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (conversationId === "new") return;
    let active = true;
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
    const optimisticUser: MobileMessage = { id: `user-${Date.now()}`, role: "user", content };
    const assistantId = `assistant-${Date.now()}`;
    setMessages((current) => [...current, optimisticUser, { id: assistantId, role: "assistant", content: "" }]);
    try {
      let id = activeId;
      if (id === "new") {
        const created = await createMobileConversation();
        id = created.id;
        setActiveId(id);
        router.setParams({ id });
      }
      const controller = new AbortController();
      abortRef.current = controller;
      await streamMobileMessage(id, content, controller.signal, (event) => {
        if (event.type === "run.started") runIdRef.current = event.runId;
        if (event.type === "message.delta") {
          setMessages((current) => current.map((message) => message.id === assistantId ? { ...message, content: message.content + event.content } : message));
        }
        if (event.type === "run.failed") {
          throw new ApiError(event.errorCode);
        }
      });
      const persisted = await getMobileConversation(id);
      setMessages(persisted.messages ?? []);
      setTitle(persisted.title);
    } catch (caught) {
      if (caught instanceof Error && caught.name === "AbortError") return;
      const key = caught instanceof ApiError && caught.code === "model_not_configured" ? "modelMissing" : "failed";
      setError(t(`chat.${key}`));
      setMessages((current) => current.filter((message) => message.id !== assistantId || message.content));
    } finally {
      abortRef.current = null;
      runIdRef.current = null;
      setSending(false);
    }
  };

  const stop = async () => {
    const partialMessage = [...messages].reverse().find(
      (message) => message.role === "assistant",
    )?.content ?? "";
    const runId = runIdRef.current;
    if (runId) await cancelMobileRun(runId, partialMessage).catch(() => undefined);
    abortRef.current?.abort();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Pressable accessibilityLabel={t("common.back")} onPress={() => router.back()} style={styles.back}><Text style={[styles.backText, { color: colors.text }]}>‹</Text></Pressable>
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
              <View style={[styles.userBubble, { backgroundColor: colors.surfaceRaised }]}><Text style={[styles.messageText, { color: colors.text }]}>{item.content}</Text></View>
            ) : (
              <View style={styles.assistantMessage}>{item.content ? <Text style={[styles.messageText, { color: colors.text }]}>{item.content}</Text> : <ActivityIndicator color={colors.accent} size="small" />}</View>
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
            <Text style={[styles.sendIcon, { color: colors.accentInk }]}>{sending ? "■" : "↑"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
