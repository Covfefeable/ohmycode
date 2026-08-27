import Feather from "@expo/vector-icons/Feather";
import { useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./SettingsHeader.styles";

export function SettingsHeader({ title }: { title: string }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const router = useRouter();
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}> 
      <Pressable accessibilityLabel={t("common.back")} onPress={() => router.back()} style={styles.back}><Feather color={colors.text} name="chevron-left" size={24} /></Pressable>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      <View style={styles.spacer} />
    </View>
  );
}
