import { useTranslation } from "react-i18next";
import styles from "./WorkspaceSelector.module.css";

type WorkspaceSelectorProps = {
  workspace: string | null;
  onChange(workspace: string | null): void;
};

export function WorkspaceSelector({ workspace, onChange }: WorkspaceSelectorProps) {
  const { t } = useTranslation();
  async function chooseWorkspace() {
    onChange(await window.ohmycode.selectWorkspace());
  }

  return (
    <div className={styles.root}>
      <button className={styles.button} onClick={chooseWorkspace}>{t("workspace.open")}</button>
      <div className={styles.selection}>
        <span>{t("workspace.currentDirectory")}</span>
        <strong title={workspace ?? undefined}>{workspace ?? t("workspace.noneSelected")}</strong>
      </div>
    </div>
  );
}
