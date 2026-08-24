import { useTranslation } from "react-i18next";
import styles from "./TaskComposer.module.css";

type TaskComposerProps = { disabled?: boolean };

export function TaskComposer({ disabled = false }: TaskComposerProps) {
  const { t } = useTranslation();
  return (
    <div className={styles.composer}>
      <textarea disabled={disabled} placeholder={disabled ? t("agent.chooseWorkspace") : t("agent.describeTask")} />
      <div className={styles.toolbar}>
        <span>{t("agent.mode")}</span>
        <button disabled>{t("agent.run")}</button>
      </div>
    </div>
  );
}
