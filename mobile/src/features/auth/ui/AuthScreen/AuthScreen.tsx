import { Link } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "@/features/auth/model/AuthProvider";
import { ApiError } from "@/shared/api/api-client";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { BrandMark } from "@/shared/ui/BrandMark/BrandMark";
import { BrandText } from "@/shared/ui/BrandText/BrandText";
import { FormField } from "@/shared/ui/FormField/FormField";
import { LanguageSwitcher } from "@/shared/ui/LanguageSwitcher/LanguageSwitcher";
import { ThemeToggle } from "@/shared/ui/ThemeToggle/ThemeToggle";
import { styles } from "./AuthScreen.styles";
import { AuthVisual } from "../AuthVisual/AuthVisual";

type Props = { mode: "login" | "register" };

export function AuthScreen({ mode }: Props) {
  const { t } = useTranslation();
  const { colors, mode: themeMode } = useTheme();
  const { width } = useWindowDimensions();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    if (busy) return;
    if (mode === "register" && password !== confirmPassword) {
      setError(t("auth.errors.password_mismatch"));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await auth[mode]({ email, password, displayName: mode === "register" ? displayName : undefined });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : "service_unavailable";
      const key = code === "invalid_credentials" || code === "email_already_registered" || code === "validation_error"
        ? code
        : code === "network_error" ? "service_unavailable" : "request_failed";
      setError(t(`auth.errors.${key}`));
    } finally {
      setBusy(false);
    }
  };

  const wide = width > 900;
  const isLogin = mode === "login";
  const panelBackground = themeMode === "dark" ? "rgba(21, 24, 29, 0.68)" : "rgba(255, 255, 255, 0.68)";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
        <AuthVisual />
        <View
          style={[
            styles.panel,
            wide ? styles.panelWide : styles.panelNarrow,
            Platform.OS === "web" ? ({ backdropFilter: "blur(28px) saturate(135%)", WebkitBackdropFilter: "blur(28px) saturate(135%)" } as object) : null,
            { backgroundColor: panelBackground, borderColor: colors.border },
          ]}
        >
          <ScrollView
            contentContainerStyle={[styles.panelContent, mode === "register" && styles.panelContentRegister]}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.formContainer}>
              <View style={styles.heading}>
                <Text style={[styles.eyebrow, { color: colors.accent }]}>{t(`auth.${isLogin ? "signInEyebrow" : "registerEyebrow"}`)}</Text>
                <BrandText style={[styles.title, { color: colors.text }]} text={t(`auth.${isLogin ? "signInTitle" : "registerTitle"}`)} />
                <Text style={[styles.subtitle, { color: colors.textMuted }]}>{t(`auth.${isLogin ? "signInDescription" : "registerDescription"}`)}</Text>
              </View>
              {error ? <Text style={[styles.error, { backgroundColor: colors.dangerSurface, borderColor: colors.danger, color: colors.danger }]}>{error}</Text> : null}
              <View style={styles.form}>
                {!isLogin && <FormField autoCapitalize="none" autoComplete="name" label={t("auth.displayName")} onChangeText={setDisplayName} placeholder={t("auth.displayNamePlaceholder")} value={displayName} />}
                <FormField autoCapitalize="none" autoComplete="email" keyboardType="email-address" label={t("auth.email")} onChangeText={setEmail} placeholder={t("auth.emailPlaceholder")} value={email} />
                <FormField autoComplete={isLogin ? "current-password" : "new-password"} label={t("auth.password")} onChangeText={setPassword} onSubmitEditing={isLogin ? () => void submit() : undefined} placeholder={t("auth.passwordPlaceholder")} secureTextEntry value={password} />
                {!isLogin && <FormField autoComplete="new-password" label={t("auth.confirmPassword")} onChangeText={setConfirmPassword} onSubmitEditing={() => void submit()} placeholder={t("auth.confirmPasswordPlaceholder")} secureTextEntry value={confirmPassword} />}
                <Pressable onPress={() => void submit()} style={({ pressed }) => [styles.submit, { backgroundColor: colors.accent, opacity: pressed || busy ? 0.65 : 1 }]}>
                  {busy ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.submitText, { color: colors.accentInk }]}>{t(`auth.${isLogin ? "signIn" : "createAccount"}`)}</Text>}
                </Pressable>
              </View>
              <Link asChild href={isLogin ? "/(auth)/register" : "/(auth)/login"}>
                <Pressable style={styles.switch}>
                  <Text style={[styles.switchText, { color: colors.textDim }]}>
                    {t(`auth.${isLogin ? "noAccount" : "hasAccount"}`)}{" "}
                    <Text style={{ color: colors.accent }}>{t(`auth.${isLogin ? "createAccount" : "signIn"}`)}</Text>
                  </Text>
                </Pressable>
              </Link>
            </View>
          </ScrollView>
        </View>
        <View style={[styles.topbar, wide ? styles.topbarWide : styles.topbarNarrow]}>
          <View style={styles.brand}>
            <BrandMark />
            <BrandText style={[styles.brandName, { color: colors.text }]} text={t("common.appName")} />
          </View>
          <View style={[styles.controls, { backgroundColor: panelBackground, borderColor: colors.border }]}>
            <LanguageSwitcher compact />
            <ThemeToggle />
          </View>
        </View>
        {wide ? (
          <View pointerEvents="none" style={styles.context}>
            <BrandText style={[styles.contextBrand, { color: colors.text }]} text={t("common.appName")} />
            <Text style={[styles.contextTagline, { color: colors.textMuted }]}>{t("auth.workspaceTagline")}</Text>
          </View>
        ) : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
