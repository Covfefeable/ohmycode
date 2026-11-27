import { FormField, TextInput } from "../../shared/ui/form-control";
import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { Select } from "../../shared/ui/select";
import { ModelPicker } from "../../shared/ui/model-picker";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { Tooltip } from "../../shared/ui/tooltip";
import { Button } from "../../shared/ui/button";
import styles from "./BackgroundTaskSettings.module.css";

export function BackgroundTaskSettings({ initial, models }: { initial: BackgroundTaskSettings; models: ModelConfiguration[] }) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [settings, setSettings] = useState(initial);
  const toggleOptions = [{ value: "true", label: t("settings.enabled") }, { value: "false", label: t("settings.disabled") }];
  function modelPicker(task: "operationApproval" | "autoSummary" | "contextCompaction" | "suggestions", disabled = false) {
    const key = `${task}ModelId` as const;
    return <ModelPicker variant="field" models={models} defaultLabel={t("settings.defaultModel")} disabled={disabled} ariaLabel={t(`settings.${task}Model`)} modelId={settings[key] ?? ""} effort={settings.reasoningEfforts?.[task]} onEffortChange={(value) => setSettings((current) => ({ ...current, reasoningEfforts: { ...current.reasoningEfforts, [task]: value } }))} onModelChange={(value) => setSettings((current) => ({ ...current, [key]: value || null, reasoningEfforts: { ...current.reasoningEfforts, [task]: "" } }))} />;
  }
  async function save() {
    try {
      const saved = await window.ohmycode.settings.saveBackgroundTasks(settings);
      setSettings(saved);
      toast({ type: "success", message: t("settings.backgroundTasksSaved") });
    } catch {
      toast({ type: "error", message: t("settings.saveFailed") });
    }
  }
  return <section className={styles.section}>
    <SettingsSectionHeader title={t("settings.backgroundTasksTitle")} description={t("settings.backgroundTasksDescription")} actions={<Button variant="primary" onClick={() => void save()}>{t("settings.saveBackgroundTasks")}</Button>} />
    <div className={styles.card}>
      <FormField><span>{t("settings.operationApproval")}</span><Select disabled ariaLabel={t("settings.operationApproval")} value="true" options={toggleOptions} onChange={() => {}} /></FormField>
      <FormField><span>{t("settings.operationApprovalModel")}</span>{modelPicker("operationApproval")}</FormField>
      <FormField><span>{t("settings.autoSummary")}<Tooltip content={t("settings.autoSummaryTooltip")}><CircleHelp /></Tooltip></span><Select ariaLabel={t("settings.autoSummary")} value={String(settings.autoSummaryEnabled)} options={toggleOptions} onChange={(value) => setSettings((current) => ({ ...current, autoSummaryEnabled: value === "true" }))} /></FormField>
      <FormField><span>{t("settings.autoSummaryModel")}</span>{modelPicker("autoSummary", !settings.autoSummaryEnabled)}</FormField>
      <FormField><span>{t("settings.contextCompactionThreshold")}</span><div className={styles.numberField}><TextInput type="number" min="1" max="100" value={settings.contextCompactionThreshold} onChange={(event) => setSettings((current) => ({ ...current, contextCompactionThreshold: Math.max(1, Math.min(100, Number(event.target.value || 1))) }))} /><span>%</span></div></FormField>
      <FormField><span>{t("settings.contextCompactionModel")}</span>{modelPicker("contextCompaction")}</FormField>
      <FormField><span>{t("settings.suggestions")}</span><Select ariaLabel={t("settings.suggestions")} value={String(settings.suggestionsEnabled)} options={toggleOptions} onChange={(value) => setSettings((current) => ({ ...current, suggestionsEnabled: value === "true" }))} /></FormField>
      <FormField><span>{t("settings.suggestionsModel")}</span>{modelPicker("suggestions", !settings.suggestionsEnabled)}</FormField>
    </div>
  </section>;
}
