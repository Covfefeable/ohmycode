import { useEffect, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { AppShell } from "../../shared/layout/app-shell";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { LoadError } from "../../shared/ui/load-error";
import { NavigationRail } from "../../widgets/navigation-rail";
import { SettingsSidebar, type SettingsTab } from "../../widgets/settings-sidebar";
import { ProfileSettings } from "../../features/profile-settings";
import { ModelSettings } from "../../features/model-settings";
import { BackgroundTaskSettings } from "../../features/background-task-settings";
import { McpSettings } from "../../features/mcp-settings";
import { SkillSettings } from "../../features/skill-settings";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const requestedTab = searchParams.get("tab");
  const tab: SettingsTab = requestedTab === "models" || requestedTab === "background" || requestedTab === "mcp" || requestedTab === "skills" ? requestedTab : "profile";
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => window.ohmycode.settings.onModelsChanged((models) => {
    setSettings((current) => current ? { ...current, models } : current);
  }), []);
  useEffect(() => window.ohmycode.settings.onProfileChanged((profile) => {
    setSettings((current) => current ? { ...current, profile } : current);
  }), []);
  useEffect(() => {
    if (!location.pathname.startsWith("/settings")) return;
    let active = true;
    void window.ohmycode.settings.get().then((value) => {
      if (active) {
        setSettings(value);
        setLoadFailed(false);
      }
    }).catch(() => { if (active) setLoadFailed(true); });
    return () => { active = false; };
  }, [location.pathname, reloadToken]);
  if (loadFailed) return <LoadError message={t("settings.loadFailed")} onRetry={() => { setLoadFailed(false); setReloadToken((value) => value + 1); }} />;
  if (!settings) return <FullScreenLoading />;
  const content = tab === "profile" ? <ProfileSettings initial={settings.profile} tokenUsage={settings.tokenUsage} />
    : tab === "models" ? <ModelSettings initial={settings.models} />
      : tab === "background" ? <BackgroundTaskSettings initial={settings.backgroundTasks} models={settings.models} />
      : tab === "mcp" ? <McpSettings /> : <SkillSettings />;
  return <AppShell navigation={<NavigationRail />} sidebar={<SettingsSidebar tab={tab} onChange={(next) => setSearchParams({ tab: next })} />}><main className={styles.content}>{content}</main></AppShell>;
}
