import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { CircleUserRound, GitFork, LogOut, Settings, SquareTerminal, UserRound } from "lucide-react";
import { useAuth } from "../../features/auth-session";
import { ThemeToggle } from "../../features/theme-toggle";
import { IconButton } from "../../shared/ui/icon-button";
import { BrandLogo } from "../../shared/ui/brand-logo";
import styles from "./NavigationRail.module.css";

export function NavigationRail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const [avatar, setAvatar] = useState("");
  useEffect(() => {
    let active = true;
    void window.ohmycode.settings.get().then((settings) => {
      if (active) setAvatar(settings.profile.avatarDataUrl ?? "");
    }).catch(() => undefined);
    const unsubscribe = window.ohmycode.settings.onProfileChanged((profile) => {
      if (active) setAvatar(profile.avatarDataUrl ?? "");
    });
    return () => { active = false; unsubscribe(); };
  }, []);
  return (
    <nav className={styles.rail} aria-label={t("navigation.label")}>
      <button className={styles.brand} aria-label="OhMyCode" onClick={() => navigate("/")}><BrandLogo /></button>
      <IconButton active={location.pathname === "/"} aria-label={t("navigation.tasks")} onClick={() => navigate("/")}><SquareTerminal /></IconButton>
      <IconButton active={location.pathname.startsWith("/agents")} aria-label={t("navigation.multiAgent")} onClick={() => navigate("/agents")}><GitFork /></IconButton>
      <IconButton active={location.pathname.startsWith("/settings")} aria-label={t("navigation.settings")} onClick={() => navigate("/settings?tab=profile")}><Settings /></IconButton>
      <div className={styles.theme}><ThemeToggle /></div>
      <div className={styles.account}>
        <IconButton aria-label={t("navigation.account")}>{avatar ? <img className={styles.avatar} src={avatar} alt="" /> : <CircleUserRound />}</IconButton>
        <div className={styles.accountMenu}>
          <button onClick={() => navigate("/settings?tab=profile")}><UserRound />{t("navigation.myProfile")}</button>
          <button onClick={() => void logout()}><LogOut />{t("navigation.signOut")}</button>
        </div>
      </div>
    </nav>
  );
}
