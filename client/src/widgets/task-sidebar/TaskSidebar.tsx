import { useTranslation } from "react-i18next";
import { ApiStatus } from "../../features/api-status";
import { WorkspaceSelector } from "../../features/workspace-selector";
import styles from "./TaskSidebar.module.css";

type TaskSidebarProps = {
  workspace: string | null;
  onWorkspaceChange(workspace: string | null): void;
};

export function TaskSidebar({ workspace, onWorkspaceChange }: TaskSidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className={styles.sidebar}>
      <header>
        <p className={styles.eyebrow}>{t("workspace.productName")}</p>
        <h2>{t("workspace.title")}</h2>
      </header>
      <WorkspaceSelector workspace={workspace} onChange={onWorkspaceChange} />
      <section className={styles.tasks}>
        <p className={styles.sectionLabel}>{t("tasks.recent")}</p>
        <div className={styles.empty}>{t("tasks.empty")}</div>
      </section>
      <footer>
        <ApiStatus />
      </footer>
    </aside>
  );
}
