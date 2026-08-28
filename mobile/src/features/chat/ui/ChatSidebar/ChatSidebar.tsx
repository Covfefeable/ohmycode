import Feather from "@expo/vector-icons/Feather";
import { spacing } from "@ohmycode/design-tokens";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Animated, FlatList, Modal, PanResponder, Pressable, Text, View } from "react-native";

import { deleteMobileConversation, listMobileConversations, type MobileConversation } from "@/features/chat/api/mobile-chat-api";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { BrandMark } from "@/shared/ui/BrandMark/BrandMark";
import { BrandText } from "@/shared/ui/BrandText/BrandText";
import { styles } from "./ChatSidebar.styles";

type Props = {
  activeConversationId: string;
  onClose(): void;
  visible: boolean;
};

const DELETE_ACTION_WIDTH = spacing[8] * 2.5;

function SwipeableConversationRow({
  deleting,
  item,
  onDelete,
  onNavigate,
  selected,
}: {
  deleting: boolean;
  item: MobileConversation;
  onDelete(id: string): void;
  onNavigate(id: string): void;
  selected: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);
  const startRef = useRef(0);
  const settle = (open: boolean) => {
    openRef.current = open;
    Animated.spring(translateX, {
      bounciness: 0,
      speed: 24,
      toValue: open ? -DELETE_ACTION_WIDTH : 0,
      useNativeDriver: true,
    }).start();
  };
  const panResponder = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => (
      Math.abs(gesture.dx) > spacing[2] && Math.abs(gesture.dx) > Math.abs(gesture.dy)
    ),
    onPanResponderGrant: () => { startRef.current = openRef.current ? -DELETE_ACTION_WIDTH : 0; },
    onPanResponderMove: (_, gesture) => {
      translateX.setValue(Math.max(-DELETE_ACTION_WIDTH, Math.min(0, startRef.current + gesture.dx)));
    },
    onPanResponderRelease: (_, gesture) => {
      const open = gesture.vx < -0.25
        || startRef.current + gesture.dx < -DELETE_ACTION_WIDTH / 2;
      settle(open);
    },
    onPanResponderTerminate: () => settle(openRef.current),
  })).current;

  return (
    <View style={[styles.swipeContainer, { backgroundColor: colors.dangerSurface }]}>
      <Pressable
        accessibilityLabel={t("navigation.deleteChat")}
        disabled={deleting}
        onPress={() => onDelete(item.id)}
        style={({ pressed }) => [
          styles.deleteAction,
          { backgroundColor: colors.danger, opacity: pressed || deleting ? 0.68 : 1 },
        ]}
      >
        {deleting
          ? <ActivityIndicator color={colors.accentInk} size="small" />
          : <Feather color={colors.accentInk} name="trash-2" size={18} />}
        <Text style={[styles.deleteText, { color: colors.accentInk }]}>{t("navigation.deleteChat")}</Text>
      </Pressable>
      <Animated.View
        {...panResponder.panHandlers}
        style={{ transform: [{ translateX }] }}
      >
        <Pressable
          onPress={() => { if (openRef.current) settle(false); else onNavigate(item.id); }}
          style={({ pressed }) => [
            styles.conversation,
            selected && styles.conversationActive,
            {
              backgroundColor: selected || pressed ? colors.surfaceHover : colors.surface,
              borderColor: colors.borderStrong,
            },
          ]}
        >
          <Text numberOfLines={1} style={[styles.conversationText, { color: selected ? colors.text : colors.textMuted }]}>{item.title}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

export function ChatSidebar({ activeConversationId, onClose, visible }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [conversations, setConversations] = useState<MobileConversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setLoading(true);
    void listMobileConversations()
      .then((items) => { if (active) setConversations(items); })
      .catch(() => { if (active) setConversations([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible]);

  const navigate = (id: string) => {
    onClose();
    router.replace({ pathname: "/(app)/chat/[id]", params: { id } });
  };

  const remove = async (id: string) => {
    if (deletingId) return;
    setDeletingId(id);
    setError("");
    try {
      await deleteMobileConversation(id);
      const remaining = conversations.filter((item) => item.id !== id);
      setConversations(remaining);
      if (id === activeConversationId) navigate(remaining[0]?.id ?? "new");
    } catch {
      setError(t("navigation.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent transparent visible={visible}>
      <View style={styles.modal}>
        <Pressable accessibilityLabel={t("navigation.closeSidebar")} onPress={onClose} style={styles.backdrop} />
        <View style={[styles.panel, { backgroundColor: colors.surface, borderRightColor: colors.border }]}> 
          <View style={styles.header}>
            <View style={styles.brand}><BrandMark /><BrandText style={[styles.brandName, { color: colors.text }]} text={t("common.appName")} /></View>
            <Pressable accessibilityLabel={t("navigation.closeSidebar")} onPress={onClose} style={({ pressed }) => [styles.close, { backgroundColor: pressed ? colors.surfaceHover : "transparent" }]}>
              <Feather color={colors.text} name="x" size={20} />
            </Pressable>
          </View>
          <Pressable onPress={() => navigate("new")} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.surfaceHover : colors.accentSoft }]}>
            <Feather color={colors.accent} name="plus" size={20} />
            <Text style={[styles.actionText, { color: colors.text }]}>{t("navigation.newChat")}</Text>
          </Pressable>
          <Pressable onPress={() => { onClose(); router.push("/(app)/settings"); }} style={({ pressed }) => [styles.action, { backgroundColor: pressed ? colors.surfaceHover : "transparent" }]}>
            <Feather color={colors.textMuted} name="settings" size={19} />
            <Text style={[styles.actionText, { color: colors.text }]}>{t("navigation.settings")}</Text>
          </Pressable>
          <View style={[styles.divider, { borderTopColor: colors.border }]} />
          <Text style={[styles.recentLabel, { color: colors.textDim }]}>{t("navigation.recentChats")}</Text>
          {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
          {loading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : (
            <FlatList
              contentContainerStyle={styles.list}
              data={conversations}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={[styles.empty, { color: colors.textDim }]}>{t("navigation.noRecentChats")}</Text>}
              renderItem={({ item }) => {
                const selected = item.id === activeConversationId;
                return (
                  <SwipeableConversationRow
                    deleting={deletingId === item.id}
                    item={item}
                    onDelete={(conversationId) => { void remove(conversationId); }}
                    onNavigate={navigate}
                    selected={selected}
                  />
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
