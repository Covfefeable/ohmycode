import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { CircleUserRound, GitFork, LogOut, Settings, SquareTerminal, UserRound } from "lucide-react";
import { useAuth } from "../../features/auth-session";
import { ThemeToggle } from "../../features/theme-toggle";
import { IconButton } from "../../shared/ui/icon-button";
import { BrandLogo } from "../../shared/ui/brand-logo";
import { Tooltip } from "../../shared/ui/tooltip";
import { toggleSidebar, useSidebarState } from "../../shared/layout/app-shell/sidebar-state";
import styles from "./NavigationRail.module.css";

export function NavigationRail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { logout } = useAuth();
  const { collapsed } = useSidebarState();
  const workspaceSelected = location.pathname === "/";
  const agentsSelected = location.pathname.startsWith("/agents");
  const settingsSelected = location.pathname.startsWith("/settings");
  function selectSection(target: string, selected: boolean) {
    if (selected) toggleSidebar();
    else navigate(target);
  }
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
      <Tooltip content={t("navigation.tasks")}><IconButton active={workspaceSelected} aria-label={t("navigation.tasks")} aria-expanded={workspaceSelected && !collapsed} aria-controls="app-sidebar" onClick={() => selectSection("/", workspaceSelected)}><SquareTerminal /></IconButton></Tooltip>
      <Tooltip content={t("navigation.multiAgent")}><IconButton active={agentsSelected} aria-label={t("navigation.multiAgent")} aria-expanded={agentsSelected && !collapsed} aria-controls="app-sidebar" onClick={() => selectSection("/agents", agentsSelected)}><GitFork /></IconButton></Tooltip>
      <Tooltip content={t("navigation.settings")}><IconButton active={settingsSelected} aria-label={t("navigation.settings")} aria-expanded={settingsSelected && !collapsed} aria-controls="app-sidebar" onClick={() => selectSection("/settings?tab=profile", settingsSelected)}><Settings /></IconButton></Tooltip>
      <div className={styles.bottom}>
        <ThemeToggle />
      </div>
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
