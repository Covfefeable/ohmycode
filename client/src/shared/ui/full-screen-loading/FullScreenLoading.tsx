import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./FullScreenLoading.module.css";

export function FullScreenLoading({ kind = "workspace" }: { kind?: "workspace" | "auth" }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <main className={styles.screen} aria-live="polite" aria-busy="true">
      {visible && (kind === "auth" ? <div className={styles.authSkeleton}><div className={styles.authPanel}><i /><i /><i /><i /></div><div className={styles.authVisual} /></div> : <div className={styles.skeleton}><div className={styles.rail} /><div className={styles.sidebar}><i /><i /><i /></div><div className={styles.content}><i /><i /><i /></div></div>)}
      <span className={styles.srOnly}>{t("auth.loading")}</span>
    </main>
  );
}
