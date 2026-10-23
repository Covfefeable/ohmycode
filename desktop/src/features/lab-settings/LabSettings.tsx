import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, FlaskConical, FolderOpen, RefreshCw } from "lucide-react";
import { useAndroidState } from "../android/useAndroidState";
import { useFeedback } from "../feedback";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import { FullScreenLoading } from "../../shared/ui/full-screen-loading";
import { LoadError } from "../../shared/ui/load-error";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./LabSettings.module.css";
import { useAndroidInstallation } from "./useAndroidInstallation";
import { AndroidInstallCard } from "./AndroidInstallCard";

export function LabSettings() {
  const { t } = useTranslation();
  const { state, failed, retry } = useAndroidState();
  const installation = useAndroidInstallation();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); }
    catch { toast({ type: "error", message: t("android.operationFailed") }); }
    finally { setBusy(false); }
  }
  if (failed) return <LoadError message={t("android.loadFailed")} onRetry={retry} />;
  if (!state) return <FullScreenLoading />;
  const running = state.phase === "running";
  const locked = busy || installation.active || state.phase === "starting" || state.phase === "stopping";
  return <section className={styles.section}>
    <SettingsSectionHeader title={t("lab.title")} description={t("lab.description")} actions={<button disabled={locked} onClick={() => void perform(() => window.ohmycode.android.refresh())}><RefreshCw />{t("android.check")}</button>} />
    <div className={styles.card}>
      <header className={styles.heading}><div className={styles.identity}><FlaskConical /><h3>{t("android.title")}</h3><span className={styles.badge}>{t("lab.experimental")}</span></div>
        <label className={styles.toggle}><input type="checkbox" checked={state.enabled} disabled={locked || running || (!state.installed && !state.enabled)} onChange={(event) => void perform(() => window.ohmycode.android.setEnabled(event.target.checked))} />{t("android.enable")}</label>
      </header>
      <p>{t("android.description")}</p>
      <div className={styles.status} role="status">{state.installed ? <Check /> : <FolderOpen />}<span>{state.issue ? t(`android.issues.${state.issue}`) : t("android.ready")}</span></div>
      <dl className={styles.details}>
        <div><dt>{t("android.sdkPath")}</dt><dd className={styles.sdkLocation}><span>{state.sdkPath || "—"}</span><Tooltip content={t("android.chooseSdk")}><IconButton className={styles.sdkButton} aria-label={t("android.chooseSdk")} disabled={locked || running} onClick={() => void perform(() => window.ohmycode.android.chooseSdk())}><FolderOpen /></IconButton></Tooltip></dd></div>
        {state.imageName && <div><dt>{t("android.image")}</dt><dd>{state.imageName}</dd></div>}
      </dl>
      {!state.installed && <p>{t("android.setupHint")}</p>}
      {(!state.installed || installation.active) && <AndroidInstallCard installation={installation} />}
      {state.error && <p className={styles.error} role="alert">{t("android.startFailed")}</p>}
    </div>
  </section>;
}
