import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Text } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth/model/AuthProvider";
import { getMobileSettings, saveMobileProfile } from "@/features/settings/api/mobile-settings-api";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { FormField } from "@/shared/ui/FormField/FormField";
import { LanguageSwitcher } from "@/shared/ui/LanguageSwitcher/LanguageSwitcher";
import { SettingsHeader } from "../SettingsHeader/SettingsHeader";
import { styles } from "./ProfileSettingsScreen.styles";

export function ProfileSettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { updateUser, user } = useAuth();
  const [displayName, setDisplayName] = useState(user?.displayName ?? "");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"error" | "saved" | "">("");

  useEffect(() => {
    let active = true;
    void getMobileSettings().then((settings) => { if (active) setDisplayName(settings.profile.displayName); }).catch(() => setStatus("error")).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const settings = await saveMobileProfile(displayName);
      setDisplayName(settings.profile.displayName);
      updateUser({ displayName: settings.profile.displayName });
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}> 
      <SettingsHeader title={t("settings.profileTitle")} />
      {loading ? <ActivityIndicator color={colors.accent} style={{ flex: 1 }} /> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.description, { color: colors.textMuted }]}>{t("settings.profileDescription")}</Text>
        <FormField label={t("auth.displayName")} onChangeText={setDisplayName} value={displayName} />
        <FormField editable={false} label={t("auth.email")} value={user?.email ?? ""} />
        <Text style={[styles.languageText, { color: colors.text }]}>{t("language.label")}</Text>
        <Text style={[styles.description, { color: colors.textMuted }]}>{t("settings.languageDescription")}</Text>
        <LanguageSwitcher />
        {status ? <Text style={[status === "saved" ? styles.success : styles.error, { color: status === "saved" ? colors.accent : colors.danger }]}>{t(`settings.${status === "saved" ? "profileSaved" : "saveFailed"}`)}</Text> : null}
        <Pressable disabled={saving || !displayName.trim()} onPress={() => void save()} style={({ pressed }) => [styles.save, { backgroundColor: colors.accent, opacity: pressed || saving || !displayName.trim() ? 0.6 : 1 }]}>
          {saving ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.saveText, { color: colors.accentInk }]}>{t("settings.saveProfile")}</Text>}
        </Pressable>
      </ScrollView>}
    </SafeAreaView>
  );
}
