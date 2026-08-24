import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AppShell } from "../../shared/layout/app-shell";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { NavigationRail } from "../../widgets/navigation-rail";
import { SettingsSidebar, type SettingsTab } from "../../widgets/settings-sidebar";
import { ProfileSettings } from "../../features/profile-settings";
import { ModelSettings } from "../../features/model-settings";
import styles from "./SettingsPage.module.css";

export function SettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: SettingsTab = searchParams.get("tab") === "models" ? "models" : "profile";
  const [settings, setSettings] = useState<PublicSettings | null>(null);
  useEffect(() => { void window.ohmycode.settings.get().then(setSettings); }, []);
  if (!settings) return <FullScreenLoading />;
  return <AppShell navigation={<NavigationRail />} sidebar={<SettingsSidebar tab={tab} onChange={(next) => setSearchParams({ tab: next })} />}><main className={styles.content}>{tab === "profile" ? <ProfileSettings initial={settings.profile} /> : <ModelSettings initial={settings.models} />}</main></AppShell>;
}
