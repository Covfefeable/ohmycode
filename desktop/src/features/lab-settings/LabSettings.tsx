import { useState } from "react";
import type { AndroidState } from "@ohmycode/android-use/types";
import { useTranslation } from "react-i18next";
import { Check, FlaskConical, FolderOpen } from "lucide-react";
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
import { AndroidDevices } from "./AndroidDevices";
import { androidErrorKey } from "../android/android-error";

export function LabSettings() {
  const { t } = useTranslation();
  const { state, failed, retry } = useAndroidState();
  if (failed) return <LoadError message={t("android.loadFailed")} onRetry={retry} />;
  if (!state) return <FullScreenLoading />;
  return <AndroidSetup state={state} />;
}

function AndroidSetup({ state }: { state: AndroidState }) {
  const { t } = useTranslation();
  const installation = useAndroidInstallation();
  const toolsInstallation = useAndroidInstallation("tools");
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState(state.adbReady ? "devices" : "adb");
  async function perform(action: () => Promise<unknown>) {
    setBusy(true);
    try { await action(); return true; }
    catch (error) { toast({ type: "error", message: t(androidErrorKey(error), { defaultValue: t("android.operationFailed") }) }); return false; }
    finally { setBusy(false); }
  }
  const running = state.phase === "running";
  const locked = busy || installation.active || state.phase === "starting" || state.phase === "stopping";
  const preparing = step === "adb" || !state.adbReady;
  return <section className={styles.section}>
    <SettingsSectionHeader title={t("lab.title")} description={t("lab.description")} actions={null} />
    <div className={styles.card}>
      <header className={styles.heading}><div className={styles.identity}><FlaskConical /><h3>{t("android.title")}</h3><span className={styles.badge}>{t("lab.experimental")}</span></div>
        <label className={styles.toggle}><input type="checkbox" checked={state.enabled} disabled={locked || running} onChange={(event) => void perform(() => window.ohmycode.android.setEnabled(event.target.checked))} />{t("android.enable")}</label>
      </header>
      <p className={styles.steps}>{t(preparing ? "android.devices.stepAdb" : "android.devices.stepDevices")}</p>
      {preparing ? <>
      <div className={styles.status} role="status">{state.adbReady ? <Check /> : <FolderOpen />}<span>{t(state.adbReady ? "android.devices.adbReady" : "android.devices.adbMissing")}</span></div>
      <dl className={styles.details}>
        <div><dt>{t("android.devices.location")}</dt><dd className={styles.sdkLocation}><span>{state.adbPath || state.sdkPath || "—"}</span><Tooltip content={t("android.chooseSdk")}><IconButton className={styles.sdkButton} aria-label={t("android.chooseSdk")} disabled={locked || running} onClick={() => void perform(() => window.ohmycode.android.chooseSdk())}><FolderOpen /></IconButton></Tooltip></dd></div>
      </dl>
      {(!state.adbReady || toolsInstallation.state && toolsInstallation.active) && <AndroidInstallCard installation={toolsInstallation} />}
      <div className={styles.actions}><button disabled={!state.adbReady || locked} onClick={() => setStep("devices")}>{t("android.devices.next")}</button></div>
      </> : <>
        <p>{t("android.devices.description")}</p>
        <AndroidDevices state={state} locked={locked || running} installation={installation} configureAdb={() => setStep("adb")} refresh={() => void perform(() => window.ohmycode.android.refresh())} remove={(serial) => perform(() => window.ohmycode.android.removeDevice(serial))} select={(target) => void perform(() => window.ohmycode.android.selectTarget(target))} />
      </>}
      {state.error && <p className={styles.error} role="alert">{t(`android.errors.${state.error}`, { defaultValue: t("android.operationFailed") })}</p>}
    </div>
  </section>;
}
