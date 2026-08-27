import Feather from "@expo/vector-icons/Feather";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { createMobileModel, getMobileSettings, saveMobileModels, testMobileModel, type MobileModelConfiguration } from "@/features/settings/api/mobile-settings-api";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { FormField } from "@/shared/ui/FormField/FormField";
import { SettingsHeader } from "../SettingsHeader/SettingsHeader";
import { styles } from "./ModelSettingsScreen.styles";

export function ModelSettingsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [models, setModels] = useState<MobileModelConfiguration[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [status, setStatus] = useState<"error" | "saved" | "">("");
  const [testStatus, setTestStatus] = useState<Record<string, "error" | "success" | undefined>>({});

  useEffect(() => {
    let active = true;
    void getMobileSettings().then((settings) => { if (active) setModels(settings.models); }).catch(() => setStatus("error")).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const update = (id: string, patch: Partial<MobileModelConfiguration>) => {
    setModels((current) => current.map((model) => model.id === id ? { ...model, ...patch } : model));
  };

  const save = async () => {
    const invalid = models.some((model) => !model.name.trim() || !model.baseUrl.trim() || !model.model.trim() || (!model.hasApiKey && !model.apiKey?.trim()));
    if (invalid) {
      setStatus("error");
      return;
    }
    setSaving(true);
    setStatus("");
    try {
      const settings = await saveMobileModels(models);
      setModels(settings.models);
      setStatus("saved");
    } catch {
      setStatus("error");
    } finally {
      setSaving(false);
    }
  };

  const test = async (model: MobileModelConfiguration) => {
    setTestingId(model.id);
    setTestStatus((current) => ({ ...current, [model.id]: undefined }));
    try {
      const result = await testMobileModel(model);
      setTestStatus((current) => ({ ...current, [model.id]: result.ok ? "success" : "error" }));
    } catch {
      setTestStatus((current) => ({ ...current, [model.id]: "error" }));
    } finally {
      setTestingId(null);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.canvas }]}> 
      <SettingsHeader title={t("settings.modelsTitle")} />
      {loading ? <ActivityIndicator color={colors.accent} style={{ flex: 1 }} /> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={[styles.description, { color: colors.textMuted }]}>{t("settings.modelsDescription")}</Text>
        {models.map((model, index) => <View key={model.id} style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text numberOfLines={1} style={[styles.cardName, { color: colors.text }]}>{model.name || t("settings.unnamedModel")}{index === 0 ? ` · ${t("settings.defaultModel")}` : ""}</Text>
            <View style={styles.actions}>
              <Pressable accessibilityLabel={t("settings.testModel")} disabled={testingId === model.id} onPress={() => void test(model)} style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? colors.surfaceHover : colors.accentSoft }]}>
                {testingId === model.id ? <ActivityIndicator color={colors.accent} size="small" /> : <Feather color={colors.accent} name="zap" size={17} />}
              </Pressable>
              <Pressable accessibilityLabel={t("settings.removeModel")} onPress={() => setModels((current) => current.filter((item) => item.id !== model.id))} style={({ pressed }) => [styles.iconButton, { backgroundColor: pressed ? colors.dangerSurface : "transparent" }]}>
                <Feather color={colors.danger} name="trash-2" size={17} />
              </Pressable>
            </View>
          </View>
          <FormField label={t("settings.configName")} onChangeText={(value) => update(model.id, { name: value })} value={model.name} />
          <FormField label={t("settings.modelName")} onChangeText={(value) => update(model.id, { model: value })} value={model.model} />
          <FormField autoCapitalize="none" autoCorrect={false} label={t("settings.baseUrl")} onChangeText={(value) => update(model.id, { baseUrl: value })} value={model.baseUrl} />
          <FormField autoCapitalize="none" autoCorrect={false} label={t("settings.apiKey")} onChangeText={(value) => update(model.id, { apiKey: value })} placeholder={model.hasApiKey ? t("settings.keyStored") : "sk-…"} secureTextEntry value={model.apiKey ?? ""} />
          <FormField keyboardType="number-pad" label={t("settings.contextLengthK")} onChangeText={(value) => update(model.id, { contextLength: Math.max(1, Number(value || 1)) * 1024 })} value={String(Math.round(model.contextLength / 1024))} />
          <View style={styles.switchRow}><Text style={[styles.switchText, { color: colors.text }]}>{t("settings.supportsVision")}</Text><Switch onValueChange={(value) => update(model.id, { supportsVision: value })} thumbColor={model.supportsVision ? colors.accent : colors.textDim} trackColor={{ false: colors.borderStrong, true: colors.accentSoft }} value={model.supportsVision} /></View>
          {testStatus[model.id] ? <Text style={[testStatus[model.id] === "success" ? styles.success : styles.error, { color: testStatus[model.id] === "success" ? colors.accent : colors.danger }]}>{t(`settings.${testStatus[model.id] === "success" ? "testSuccess" : "testFailed"}`)}</Text> : null}
        </View>)}
        <Pressable onPress={() => setModels((current) => [...current, createMobileModel()])} style={({ pressed }) => [styles.add, { backgroundColor: pressed ? colors.surfaceHover : colors.surface, borderColor: colors.border }]}><Feather color={colors.text} name="plus" size={18} /><Text style={[styles.addText, { color: colors.text }]}>{t("settings.addModel")}</Text></Pressable>
        {status ? <Text style={[status === "saved" ? styles.success : styles.error, { color: status === "saved" ? colors.accent : colors.danger }]}>{t(`settings.${status === "saved" ? "modelsSaved" : "saveFailed"}`)}</Text> : null}
        <Pressable disabled={saving} onPress={() => void save()} style={({ pressed }) => [styles.save, { backgroundColor: colors.accent, opacity: pressed || saving ? 0.6 : 1 }]}>{saving ? <ActivityIndicator color={colors.accentInk} /> : <Text style={[styles.saveText, { color: colors.accentInk }]}>{t("settings.saveModels")}</Text>}</Pressable>
      </ScrollView>}
    </SafeAreaView>
  );
}
