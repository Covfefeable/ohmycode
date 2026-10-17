import { AlertTriangle } from "lucide-react";
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import styles from "./ConfirmDialog.module.css";

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  busy?: boolean;
  onCancel(): void;
  onConfirm(): void;
};

export function ConfirmDialog({ open, title, description, confirmLabel, busy = false, onCancel, onConfirm }: ConfirmDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      if (!busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, onCancel, open]);
  if (!open) return null;
  return createPortal(<div className={styles.backdrop} onMouseDown={() => !busy && onCancel()}>
    <section className={styles.dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} onMouseDown={(event) => event.stopPropagation()}>
      <div className={styles.icon}><AlertTriangle /></div>
      <div><h2 id={titleId}>{title}</h2><p>{description}</p></div>
      <footer><button disabled={busy} onClick={onCancel}>{t("common.cancel")}</button><button className={styles.danger} disabled={busy} onClick={onConfirm}>{confirmLabel ?? t("common.delete")}</button></footer>
    </section>
  </div>, document.body);
}
