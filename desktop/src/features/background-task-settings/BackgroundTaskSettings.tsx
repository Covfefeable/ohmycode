import { CircleHelp } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { Select } from "../../shared/ui/select";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./BackgroundTaskSettings.module.css";

export function BackgroundTaskSettings({ initial, models }: { initial: BackgroundTaskSettings; models: ModelConfiguration[] }) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [settings, setSettings] = useState(initial);
  const modelOptions = [{ value: "", label: t("settings.defaultModel") }, ...models.map((model) => ({ value: model.id, label: model.name || model.model }))];
  const toggleOptions = [{ value: "true", label: t("settings.enabled") }, { value: "false", label: t("settings.disabled") }];
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
    <SettingsSectionHeader title={t("settings.backgroundTasksTitle")} description={t("settings.backgroundTasksDescription")} actions={<button className={styles.primaryAction} onClick={() => void save()}>{t("settings.saveBackgroundTasks")}</button>} />
    <div className={styles.card}>
      <label><span>{t("settings.autoSummary")}<Tooltip content={t("settings.autoSummaryTooltip")}><CircleHelp /></Tooltip></span><Select ariaLabel={t("settings.autoSummary")} value={String(settings.autoSummaryEnabled)} options={toggleOptions} onChange={(value) => setSettings((current) => ({ ...current, autoSummaryEnabled: value === "true" }))} /></label>
      <label><span>{t("settings.autoSummaryModel")}</span><Select disabled={!settings.autoSummaryEnabled} ariaLabel={t("settings.autoSummaryModel")} value={settings.autoSummaryModelId ?? ""} options={modelOptions} onChange={(value) => setSettings((current) => ({ ...current, autoSummaryModelId: value || null }))} /></label>
      <label><span>{t("settings.contextCompactionThreshold")}</span><div className={styles.numberField}><input type="number" min="1" max="100" value={settings.contextCompactionThreshold} onChange={(event) => setSettings((current) => ({ ...current, contextCompactionThreshold: Math.max(1, Math.min(100, Number(event.target.value || 1))) }))} /><span>%</span></div></label>
      <label><span>{t("settings.contextCompactionModel")}</span><Select ariaLabel={t("settings.contextCompactionModel")} value={settings.contextCompactionModelId ?? ""} options={modelOptions} onChange={(value) => setSettings((current) => ({ ...current, contextCompactionModelId: value || null }))} /></label>
      <label><span>{t("settings.suggestions")}</span><Select ariaLabel={t("settings.suggestions")} value={String(settings.suggestionsEnabled)} options={toggleOptions} onChange={(value) => setSettings((current) => ({ ...current, suggestionsEnabled: value === "true" }))} /></label>
      <label><span>{t("settings.suggestionsModel")}</span><Select disabled={!settings.suggestionsEnabled} ariaLabel={t("settings.suggestionsModel")} value={settings.suggestionsModelId ?? ""} options={modelOptions} onChange={(value) => setSettings((current) => ({ ...current, suggestionsModelId: value || null }))} /></label>
    </div>
  </section>;
}
