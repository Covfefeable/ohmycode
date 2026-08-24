import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleUserRound } from "lucide-react";
import { useAuth } from "../auth-session";
import { useFeedback } from "../feedback";
import { LanguageSwitcher } from "../language-switcher";
import { TokenUsageCalendar } from "../token-usage-calendar";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import styles from "./ProfileSettings.module.css";

export function ProfileSettings({ initial, tokenUsage }: { initial: PublicSettings["profile"]; tokenUsage: TokenUsageEntry[] }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [displayName, setDisplayName] = useState(initial.displayName || user?.displayName || "");
  async function save() {
    try { await window.ohmycode.settings.saveProfile(displayName); toast({ type: "success", message: t("settings.profileSaved") }); }
    catch { toast({ type: "error", message: t("settings.saveFailed") }); }
  }
  return <section className={styles.section}>
    <SettingsSectionHeader title={t("settings.profileTitle")} description={t("settings.profileDescription")} actions={<button className={styles.primaryAction} onClick={() => void save()}>{t("settings.save")}</button>} />
    <div className={styles.avatar}><CircleUserRound /></div>
    <label><span>{t("auth.displayName")}</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
    <label><span>{t("auth.email")}</span><input value={user?.email ?? ""} disabled /></label>
    <LanguageSwitcher />
    <TokenUsageCalendar entries={tokenUsage} />
  </section>;
}
