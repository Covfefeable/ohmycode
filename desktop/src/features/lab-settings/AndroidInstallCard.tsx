import { Button } from "../../shared/ui/button";
import { type ReactNode, useState } from "react";
import { Download, LoaderCircle, RotateCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../feedback";
import { Tooltip } from "../../shared/ui/tooltip";
import { AndroidInstallDialog } from "./AndroidInstallDialog";
import type { useAndroidInstallation } from "./useAndroidInstallation";
import styles from "./AndroidInstallCard.module.css";

export function AndroidInstallCard({ installation, compact = false, disabled = false, actions }: { installation: ReturnType<typeof useAndroidInstallation>; compact?: boolean; disabled?: boolean; actions?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const [dialog, setDialog] = useState(false);
  const { state, plan, active, failed } = installation;
  const bytes = (size: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(size / 1e6);
  const errorKey = `android.install.errors.${state?.error}`;
  async function cancel() {
    try { await window.ohmycode.android.cancelInstall(); }
    catch { toast({ type: "error", message: t("android.install.requestFailed") }); }
  }
  const estimate = plan ? t("android.install.estimate", { size: new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 2 }).format(plan.totalBytes / 1e9) }) : "";
  const installButton = <Button variant="primary" disabled={disabled || !plan || active} onClick={() => setDialog(true)}><Download />{t(plan?.mode === "tools" ? "android.devices.installTools" : "android.install.now")}</Button>;
  if (failed) return <div className={styles.card}><p>{t("android.install.planFailed")}</p><div className={styles.actions}><Button onClick={installation.retry}><RotateCw />{t("common.retry")}</Button>{actions}</div></div>;
  return <div className={`${styles.card} ${compact ? styles.compact : ""}`}>
    {active && state ? <>
      <div className={styles.heading} role="status"><span><LoaderCircle className={styles.spin} />{t(`android.install.phases.${state.phase}`)}{state.component && <small>{t(`android.install.components.${state.component}`)}</small>}</span><Button disabled={state.phase === "finishing"} onClick={() => void cancel()}><X />{t("android.install.cancel")}</Button></div>
      <progress aria-label={t("android.install.progress")} value={state.receivedBytes} max={state.totalBytes || 1} />
      <small>{t("android.install.downloaded", { received: bytes(state.receivedBytes), total: bytes(state.totalBytes) })}</small>
      {actions && <div className={styles.actions}>{actions}</div>}
    </> : <>
      {state?.phase === "error" && <p role="alert" className={styles.error}>{t(i18n.exists(errorKey) ? errorKey : "android.install.errors.android_install_failed")}</p>}
      {state?.phase === "canceled" && <p>{t("android.install.canceled")}</p>}
      <div className={styles.actions}>{plan?.mode === "tools" ? <Tooltip content={estimate}>{installButton}</Tooltip> : installButton}{actions}</div>
      {!compact && plan && plan.mode !== "tools" && <small>{estimate}</small>}
    </>}
    {dialog && plan && <AndroidInstallDialog plan={plan} chooseRoot={installation.chooseRoot} onClose={() => setDialog(false)} />}
  </div>;
}
