import { useTranslation } from "react-i18next";
import styles from "./WindowControls.module.css";

export function WindowControls() {
  const { t } = useTranslation();
  return (
    <div className={styles.titleArea}>
      <div className={styles.dragRegion} />
      <div className={styles.controls}>
        <button aria-label={t("window.minimize")} onClick={() => window.ohmycode.windowControls.minimize()}>—</button>
        <button aria-label={t("window.maximize")} onClick={() => window.ohmycode.windowControls.toggleMaximize()}>□</button>
        <button className={styles.close} aria-label={t("window.close")} onClick={() => window.ohmycode.windowControls.close()}>×</button>
      </div>
    </div>
  );
}

