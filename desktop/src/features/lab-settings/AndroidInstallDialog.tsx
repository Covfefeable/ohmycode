import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { Download, LoaderCircle, X } from "lucide-react";
import type { AndroidInstallPlan } from "@ohmycode/android-use/types";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import { useFeedback } from "../feedback";
import styles from "./AndroidInstallDialog.module.css";

export function AndroidInstallDialog({ plan, chooseRoot, onClose }: { plan: AndroidInstallPlan; chooseRoot(): Promise<void>; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const title = useId();
  const size = (bytes: number) => new Intl.NumberFormat(i18n.language, { style: "unit", unit: bytes >= 1e9 ? "gigabyte" : "megabyte", maximumFractionDigits: 2 }).format(bytes / (bytes >= 1e9 ? 1e9 : 1e6));
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const nodes = dialog.current!.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled)");
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [busy, onClose]);
  async function perform(action: () => Promise<unknown>, close = false) {
    setBusy(true);
    try { await action(); if (close) onClose(); }
    catch { toast({ type: "error", message: t("android.install.requestFailed") }); }
    finally { setBusy(false); }
  }
  return createPortal(<div className={styles.backdrop} onMouseDown={() => !busy && onClose()}>
    <section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title} className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2 id={title}>{t("android.install.title")}</h2><IconButton disabled={busy} aria-label={t("common.close")} onClick={onClose}><X /></IconButton></header>
      <p>{t("android.install.summary", { size: size(plan.totalBytes), free: size(plan.requiredFreeBytes) })}</p>
      <ul>{plan.components.map((component) => <li key={component.id}><span>{t(`android.install.components.${component.id}`)} <small>{component.version}</small></span><span>{size(component.bytes)}</span></li>)}</ul>
      <div className={styles.location}><Tooltip content={plan.root}><span>{plan.root}</span></Tooltip><button disabled={busy} onClick={() => void perform(chooseRoot)}>{t("android.install.chooseLocation")}</button></div>
      <p>{t("android.install.virtualizationHint")}</p>
      <label className={styles.consent}><input type="checkbox" checked={consent} disabled={busy} onChange={(event) => setConsent(event.target.checked)} /><span>{t("android.install.consent")} <button className={styles.link} onClick={() => void perform(() => window.ohmycode.android.openLicense())}>{t("android.install.license")}</button></span></label>
      <footer><button disabled={busy} onClick={onClose}>{t("common.cancel")}</button><button className={styles.primary} disabled={!consent || busy} onClick={() => void perform(() => window.ohmycode.android.install(true), true)}>{busy ? <LoaderCircle className={styles.spin} /> : <Download />}{t("android.install.now")}</button></footer>
    </section>
  </div>, document.body);
}
