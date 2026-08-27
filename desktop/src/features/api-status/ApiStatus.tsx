import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./ApiStatus.module.css";

type ApiStatusState = { online: boolean; url: string };
const initialStatus: ApiStatusState = { online: false, url: "" };

export function ApiStatus() {
  const { t } = useTranslation();
  const [status, setStatus] = useState(initialStatus);

  useEffect(() => {
    const refresh = () => void window.ohmycode.apiStatus().then(setStatus);
    refresh();
    const timer = window.setInterval(refresh, 3000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={styles.status} title={status.url}>
      <span className={`${styles.dot} ${status.online ? styles.online : ""}`} />
      {status.online ? t("api.connected") : t("api.starting")}
    </div>
  );
}
