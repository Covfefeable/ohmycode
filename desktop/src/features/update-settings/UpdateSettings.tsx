import { Check, Download, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsSectionHeader } from "../../shared/ui/settings-section-header";
import styles from "./UpdateSettings.module.css";

type CheckState = "checking" | "ready" | "error";

export function UpdateSettings() {
  const { t } = useTranslation();
  const [state, setState] = useState<CheckState>("checking");
  const [result, setResult] = useState<UpdateCheckResult | null>(null);

  async function check() {
    setState("checking");
    try {
      setResult(await window.ohmycode.updates.check());
      setState("ready");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    let active = true;
    void window.ohmycode.updates.check()
      .then((value) => {
        if (!active) return;
        setResult(value);
        setState("ready");
      })
      .catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, []);

  const available = result?.status === "available";
  return <section className={styles.section}>
    <SettingsSectionHeader
      title={t("settings.updatesTitle")}
      description={t("settings.updatesDescription")}
      actions={<button className={styles.checkButton} disabled={state === "checking"} onClick={() => void check()}>
        <RefreshCw className={state === "checking" ? styles.spinning : undefined} />
        {state === "checking" ? t("settings.checkingForUpdates") : t("settings.checkForUpdates")}
      </button>}
    />
    <div className={styles.statusPanel}>
      <div className={`${styles.statusIcon} ${state === "error" ? styles.errorIcon : available ? styles.updateIcon : ""}`}>
        {state === "checking" ? <RefreshCw className={styles.spinning} /> : state === "error" ? <TriangleAlert /> : available ? <Download /> : <Check />}
      </div>
      <div className={styles.statusCopy}>
        <h3>{state === "checking" ? t("settings.checkingForUpdates") : state === "error" ? t("settings.updateCheckFailed") : available ? t("settings.updateAvailable") : t("settings.upToDate")}</h3>
        <p>{state === "checking" ? t("settings.updateCheckingHint") : state === "error" ? t("settings.updateCheckFailedHint") : available ? t("settings.updateAvailableHint", { version: result?.latestVersion }) : t("settings.upToDateHint")}</p>
      </div>
      {available && <button className={styles.downloadButton} onClick={() => void window.ohmycode.updates.openDownload()}>
        <Download />{t("settings.openGitHubRelease")}
      </button>}
    </div>
    {result && <dl className={styles.versionDetails}>
      <div><dt>{t("settings.currentVersion")}</dt><dd>{result.currentVersion}</dd></div>
      <div><dt>{t("settings.latestVersion")}</dt><dd>{result.latestVersion}</dd></div>
      {result.publishedAt && <div><dt>{t("settings.releaseDate")}</dt><dd>{new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(result.publishedAt))}</dd></div>}
    </dl>}
  </section>;
}
