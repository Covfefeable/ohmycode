import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth/model/AuthProvider";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { SettingsHeader } from "../SettingsHeader/SettingsHeader";
import { styles } from "./SettingsMenuScreen.styles";

export function SettingsMenuScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { logout } = useAuth();
  const router = useRouter();
  const items = [
    { description: t("settings.profileDescription"), icon: "user" as const, path: "/(app)/settings/profile" as const, title: t("settings.profileTitle") },
    { description: t("settings.modelsDescription"), icon: "cpu" as const, path: "/(app)/settings/models" as const, title: t("settings.modelsTitle") },
  ] as const;
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}> 
      <SettingsHeader title={t("settings.title")} />
      <View style={styles.content}>
        {items.map((item) => <Pressable key={item.path} onPress={() => router.push(item.path)} style={({ pressed }) => [styles.card, { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border }]}>
          <View style={[styles.icon, { backgroundColor: colors.accentSoft }]}><Feather color={colors.accent} name={item.icon} size={20} /></View>
          <View style={styles.cardCopy}><Text style={[styles.cardTitle, { color: colors.text }]}>{item.title}</Text><Text style={[styles.cardDescription, { color: colors.textMuted }]}>{item.description}</Text></View>
          <Feather color={colors.textDim} name="chevron-right" size={20} />
        </Pressable>)}
        <Pressable accessibilityRole="button" onPress={() => void logout()} style={({ pressed }) => [styles.logout, { backgroundColor: pressed ? colors.dangerSurface : "transparent", borderColor: colors.border }]}>
          <Feather color={colors.danger} name="log-out" size={19} />
          <Text style={[styles.logoutText, { color: colors.danger }]}>{t("auth.signOut")}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}
