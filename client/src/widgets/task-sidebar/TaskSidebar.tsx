import { useTranslation } from "react-i18next";
import { ApiStatus } from "../../features/api-status";
import { ProjectList } from "../../features/project-list";
import styles from "./TaskSidebar.module.css";

type TaskSidebarProps = {
  workspace: string | null;
  onWorkspaceChange(workspace: string | null): void;
};

export function TaskSidebar({ workspace, onWorkspaceChange }: TaskSidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className={styles.sidebar}>
      <ProjectList workspace={workspace} onWorkspaceChange={onWorkspaceChange} heading={<header>
        <p className={styles.eyebrow}>{t("workspace.productName")}</p>
        <h2>{t("workspace.title")}</h2>
      </header>} />
      <footer>
        <ApiStatus />
      </footer>
    </aside>
  );
}
