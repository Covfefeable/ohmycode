import { useRef, useState } from "react";
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
  const [avatar, setAvatar] = useState(initial.avatarDataUrl ?? "");
  const [pendingAvatar, setPendingAvatar] = useState<{ data: string; contentType: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  async function save() {
    try {
      let profile = await window.ohmycode.settings.saveProfile(displayName);
      if (pendingAvatar) {
        profile = await window.ohmycode.settings.saveAvatar(pendingAvatar.data, pendingAvatar.contentType);
      }
      setAvatar(profile.avatarDataUrl ?? "");
      setDisplayName(profile.displayName);
      setPendingAvatar(null);
      toast({ type: "success", message: t("settings.profileSaved") });
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast({
        type: "error",
        message: t(message.includes("object_storage_unavailable")
          ? "settings.avatarStorageUnavailable"
          : "settings.saveFailed"),
      });
    }
  }
  function chooseAvatar(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ type: "error", message: t("settings.avatarInvalid") });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      setAvatar(dataUrl);
      setPendingAvatar({ data: dataUrl.split(",", 2)[1] || "", contentType: file.type });
    };
    reader.readAsDataURL(file);
  }
  return <section className={styles.section}>
    <SettingsSectionHeader title={t("settings.profileTitle")} description={t("settings.profileDescription")} actions={<button className={styles.primaryAction} onClick={() => void save()}>{t("settings.save")}</button>} />
    <button className={styles.avatar} type="button" aria-label={t("settings.changeAvatar")} onClick={() => fileRef.current?.click()}>
      {avatar ? <img src={avatar} alt="" /> : <CircleUserRound />}
      <span>{t("settings.changeAvatar")}</span>
    </button>
    <input ref={fileRef} className={styles.avatarInput} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { chooseAvatar(event.target.files?.[0]); event.target.value = ""; }} />
    <label><span>{t("auth.displayName")}</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
    <label><span>{t("auth.email")}</span><input value={user?.email ?? ""} disabled /></label>
    <LanguageSwitcher />
    <TokenUsageCalendar entries={tokenUsage} />
  </section>;
}
