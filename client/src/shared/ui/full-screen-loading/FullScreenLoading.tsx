import { useTranslation } from "react-i18next";
import styles from "./FullScreenLoading.module.css";

export function FullScreenLoading() {
  const { t } = useTranslation();
  return (
    <main className={styles.screen} aria-live="polite" aria-busy="true">
      <div className={styles.mark}>OM</div>
      <div className={styles.spinner} />
      <p>{t("auth.loading")}</p>
    </main>
  );
}

