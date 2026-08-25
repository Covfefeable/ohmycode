import { useTranslation } from "react-i18next";
import { RotateCw } from "lucide-react";
import styles from "./LoadError.module.css";

export function LoadError({ message, onRetry }: { message: string; onRetry(): void }) {
  const { t } = useTranslation();
  return <div className={styles.screen} role="alert">
    <div className={styles.card}>
      <strong>{message}</strong>
      <button className={styles.retry} onClick={onRetry}><RotateCw />{t("common.retry")}</button>
    </div>
  </div>;
}
