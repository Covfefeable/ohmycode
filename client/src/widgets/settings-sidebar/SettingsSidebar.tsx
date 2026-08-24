import { useTranslation } from "react-i18next";
import { Bot, CircleUserRound } from "lucide-react";
import styles from "./SettingsSidebar.module.css";

export type SettingsTab = "profile" | "models";
export function SettingsSidebar({ tab, onChange }: { tab: SettingsTab; onChange(tab: SettingsTab): void }) {
  const { t } = useTranslation();
  return <aside className={styles.sidebar}>
    <header><h1>{t("settings.title")}</h1></header>
    <nav>
      <button className={tab === "profile" ? styles.active : ""} onClick={() => onChange("profile")}><CircleUserRound />{t("settings.profileTab")}</button>
      <button className={tab === "models" ? styles.active : ""} onClick={() => onChange("models")}><Bot />{t("settings.modelsTab")}</button>
    </nav>
  </aside>;
}
