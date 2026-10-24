import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./FullScreenLoading.module.css";

export function FullScreenLoading({ kind = "content" }: { kind?: "workspace" | "auth" | "content" | "conversation" }) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 180);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className={`${styles.screen} ${kind === "workspace" || kind === "auth" ? styles.fullScreen : ""}`} aria-live="polite" aria-busy="true">
      {visible && (kind === "auth" ? <div className={styles.authSkeleton}><div className={styles.authPanel}><i /><i /><i /><i /></div><div className={styles.authVisual} /></div>
        : kind === "workspace" ? <div className={styles.skeleton}><div className={styles.rail} /><div className={styles.sidebar}><i /><i /><i /></div><div className={styles.content}><i /><i /><i /></div></div>
          : kind === "conversation" ? <div className={styles.conversation}><i className={styles.title} /><div className={styles.messages}><i /><i /><i /></div><i className={styles.composer} /></div>
            : <div className={styles.content}><i /><i /><i /></div>)}
      <span className={styles.srOnly}>{t("auth.loading")}</span>
    </div>
  );
}
