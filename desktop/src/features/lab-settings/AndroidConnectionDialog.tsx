import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { LoaderCircle, X } from "lucide-react";
import { IconButton } from "../../shared/ui/icon-button";
import { androidErrorKey } from "../android/android-error";
import styles from "./AndroidConnectionDialog.module.css";

export function AndroidConnectionDialog({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialog.current!.showModal(); return () => previous?.focus(); }, []);
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={title} onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={title}>{t("android.devices.add")}</h2><IconButton aria-label={t("common.close")} disabled={busy} onClick={onClose}><X /></IconButton></header>
    <form onSubmit={(event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      setBusy(true); setError(undefined);
      void window.ohmycode.android.connect(String(data.get("address")), String(data.get("name") ?? ""))
        .then(onClose).catch((error) => setError(t(androidErrorKey(error), { defaultValue: t("android.operationFailed") }))).finally(() => setBusy(false));
    }}>
      <label>{t("android.devices.address")}<input name="address" required autoFocus disabled={busy} placeholder={t("android.devices.addressPlaceholder")} autoComplete="off" /></label>
      <label>{t("android.devices.name")}<input name="name" maxLength={100} disabled={busy} placeholder={t("android.devices.namePlaceholder")} autoComplete="off" /></label>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>{t("common.cancel")}</button><button className={styles.primary} disabled={busy}>{busy && <LoaderCircle className={styles.spin} />}{t("android.devices.connect")}</button></footer>
    </form>
  </dialog>, document.body);
}
