import { Link } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth/model/AuthProvider";
import { ApiError } from "@/shared/api/api-client";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { BrandMark } from "@/shared/ui/BrandMark/BrandMark";
import { FormField } from "@/shared/ui/FormField/FormField";
import { ThemeToggle } from "@/shared/ui/ThemeToggle/ThemeToggle";
import { styles } from "./AuthScreen.styles";
import { AuthVisual } from "../AuthVisual/AuthVisual";

type Props = { mode: "login" | "register" };

export function AuthScreen({ mode }: Props) {
  const { t } = useTranslation();
  const { colors, mode: themeMode } = useTheme();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await auth[mode]({ email, password, displayName: mode === "register" ? displayName : undefined });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "network_error";
      const key = code === "invalid_credentials" ? "invalidCredentials"
        : code === "email_already_registered" ? "emailExists"
          : code === "network_error" ? "networkError" : "validationError";
      setError(t(`auth.${key}`));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}> 
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
        <AuthVisual />
        <View style={styles.topbar}>
          <View style={styles.brand}><BrandMark /><Text style={[styles.brandName, { color: colors.text }]}>OhMyCode</Text></View>
          <ThemeToggle />
        </View>
        <View style={styles.content}>
          <View style={[styles.glass, Platform.OS === "web" ? ({ backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" } as object) : null, { backgroundColor: themeMode === "dark" ? "rgba(21, 24, 29, 0.72)" : "rgba(255, 255, 255, 0.72)", borderColor: colors.border }]}> 
          <View style={styles.heading}>
            <Text style={[styles.title, { color: colors.text }]}>{t(`auth.${mode}Title`)}</Text>
            <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t(`auth.${mode}Subtitle`)}</Text>
          </View>
          <View style={styles.form}>
            {mode === "register" && <FormField autoCapitalize="none" label={t("auth.name")} onChangeText={setDisplayName} placeholder={t("auth.namePlaceholder")} value={displayName} />}
            <FormField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label={t("auth.email")} onChangeText={setEmail} placeholder={t("auth.emailPlaceholder")} value={email} />
            <FormField autoComplete={mode === "login" ? "current-password" : "new-password"} label={t("auth.password")} onChangeText={setPassword} onSubmitEditing={() => void submit()} placeholder={t("auth.passwordPlaceholder")} secureTextEntry value={password} />
            {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}
            <Pressable onPress={() => void submit()} style={({ pressed }) => [styles.submit, { backgroundColor: colors.accent, opacity: pressed || busy ? 0.75 : 1 }]}>
              {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.submitText, { color: colors.accentInk }]}>{t(`auth.${mode}`)}</Text>}
            </Pressable>
          </View>
          <Link asChild href={mode === "login" ? "/(auth)/register" : "/(auth)/login"}>
            <Pressable><Text style={[styles.switchText, { color: colors.textMuted }]}>{t(`auth.${mode === "login" ? "toRegister" : "toLogin"}`)}</Text></Pressable>
          </Link>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
