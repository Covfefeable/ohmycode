import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Modal, Pressable, Text, View } from "react-native";

import { listMobileConversations, type MobileConversation } from "@/features/chat/api/mobile-chat-api";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { BrandMark } from "@/shared/ui/BrandMark/BrandMark";
import { BrandText } from "@/shared/ui/BrandText/BrandText";
import { styles } from "./ChatSidebar.styles";

type Props = {
  activeConversationId: string;
  onClose(): void;
  visible: boolean;
};

export function ChatSidebar({ activeConversationId, onClose, visible }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  const [conversations, setConversations] = useState<MobileConversation[]>([]);
  const [loading, setLoading] = useState(false);

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
          {loading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : (
            <FlatList
              contentContainerStyle={styles.list}
              data={conversations}
              keyExtractor={(item) => item.id}
              ListEmptyComponent={<Text style={[styles.empty, { color: colors.textDim }]}>{t("navigation.noRecentChats")}</Text>}
              renderItem={({ item }) => {
                const selected = item.id === activeConversationId;
                return (
                  <Pressable onPress={() => navigate(item.id)} style={({ pressed }) => [styles.conversation, selected && styles.conversationActive, { backgroundColor: selected || pressed ? colors.surfaceHover : "transparent", borderColor: colors.borderStrong }]}>
                    <Text numberOfLines={1} style={[styles.conversationText, { color: selected ? colors.text : colors.textMuted }]}>{item.title}</Text>
                  </Pressable>
                );
              }}
            />
          )}
        </View>
      </View>
    </Modal>
  );
}
