import { useTranslation } from "react-i18next";
import { Bot, CircleUserRound, PackageOpen, PlugZap, RefreshCw, Timer } from "lucide-react";
import styles from "./SettingsSidebar.module.css";

export type SettingsTab = "profile" | "models" | "background" | "mcp" | "skills" | "updates";
export function SettingsSidebar({ tab, onChange }: { tab: SettingsTab; onChange(tab: SettingsTab): void }) {
  const { t } = useTranslation();
  return <aside className={styles.sidebar}>
    <header><h1>{t("settings.title")}</h1></header>
    <nav>
      <button className={tab === "profile" ? styles.active : ""} onClick={() => onChange("profile")}><CircleUserRound />{t("settings.profileTab")}</button>
      <button className={tab === "models" ? styles.active : ""} onClick={() => onChange("models")}><Bot />{t("settings.modelsTab")}</button>
      <button className={tab === "background" ? styles.active : ""} onClick={() => onChange("background")}><Timer />{t("settings.backgroundTasksTab")}</button>
      <button className={tab === "mcp" ? styles.active : ""} onClick={() => onChange("mcp")}><PlugZap />{t("settings.mcpTab")}</button>
      <button className={tab === "skills" ? styles.active : ""} onClick={() => onChange("skills")}><PackageOpen />{t("settings.skillsTab")}</button>
      <button className={tab === "updates" ? styles.active : ""} onClick={() => onChange("updates")}><RefreshCw />{t("settings.updatesTab")}</button>
    </nav>
  </aside>;
}
