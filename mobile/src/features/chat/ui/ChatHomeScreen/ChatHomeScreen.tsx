import Feather from "@expo/vector-icons/Feather";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth/model/AuthProvider";
import { listMobileConversations, type MobileConversation } from "@/features/chat/api/mobile-chat-api";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { BrandMark } from "@/shared/ui/BrandMark/BrandMark";
import { ThemeToggle } from "@/shared/ui/ThemeToggle/ThemeToggle";
import { styles } from "./ChatHomeScreen.styles";

export function ChatHomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { logout, user } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<MobileConversation[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    let active = true;
    setLoading(true);
    void listMobileConversations()
      .then((items) => { if (active) setConversations(items); })
      .catch(() => { if (active) setConversations([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <View style={styles.brand}><BrandMark /><Text style={[styles.brandName, { color: colors.text }]}>OhMyCode</Text></View>
        <View style={styles.actions}>
          <ThemeToggle />
          <Pressable
            accessibilityLabel={t("home.signOut")}
            onPress={() => void logout()}
            style={({ pressed }) => [styles.avatar, { backgroundColor: colors.surfaceRaised, opacity: pressed ? 0.7 : 1 }]}
          >
            <Text style={[styles.avatarText, { color: colors.text }]}>{user?.displayName.slice(0, 1).toUpperCase()}</Text>
          </Pressable>
        </View>
      </View>
      <View style={styles.content}>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>{t("home.eyebrow")}</Text>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]}>{t("home.title")}</Text>
          <Pressable onPress={() => router.push({ pathname: "/(app)/chat/[id]", params: { id: "new" } })} style={({ pressed }) => [styles.newButton, { backgroundColor: colors.accent, opacity: pressed ? 0.75 : 1 }]}>
            <Feather color={colors.accentInk} name="plus" size={17} /><Text style={[styles.newButtonText, { color: colors.accentInk }]}>{t("home.newChat")}</Text>
          </Pressable>
        </View>
        <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t("home.subtitle")}</Text>
        {loading ? <ActivityIndicator color={colors.accent} style={styles.loader} /> : conversations.length ? (
          <FlatList
            contentContainerStyle={styles.list}
            data={conversations}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable onPress={() => router.push({ pathname: "/(app)/chat/[id]", params: { id: item.id } })} style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border }]}>
                <Text numberOfLines={1} style={[styles.rowTitle, { color: colors.text }]}>{item.title}</Text>
                <Feather color={colors.textDim} name="chevron-right" size={20} />
              </Pressable>
            )}
          />
        ) : <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={[styles.emptyMark, { backgroundColor: colors.accentSoft }]}>
            <Feather color={colors.accent} name="plus" size={22} />
          </View>
          <Text style={[styles.emptyTitle, { color: colors.text }]}>{t("home.emptyTitle")}</Text>
          <Text style={[styles.emptyDescription, { color: colors.textMuted }]}>{t("home.emptyDescription")}</Text>
        </View>}
      </View>
    </SafeAreaView>
  );
}
