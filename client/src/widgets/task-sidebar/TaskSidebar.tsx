import { useTranslation } from "react-i18next";
import { ApiStatus } from "../../features/api-status";
import { ProjectList } from "../../features/project-list";
import styles from "./TaskSidebar.module.css";

type TaskSidebarProps = {
  selectedConversationId: string | null;
  onConversationSelect(project: LocalProject, conversation: LocalConversation): void;
  onConversationDelete(conversationId: string): void;
  refreshToken: number;
};

export function TaskSidebar({ selectedConversationId, onConversationSelect, onConversationDelete, refreshToken }: TaskSidebarProps) {
  const { t } = useTranslation();
  return (
    <aside className={styles.sidebar}>
      <ProjectList selectedConversationId={selectedConversationId} onConversationSelect={onConversationSelect} onConversationDelete={onConversationDelete} refreshToken={refreshToken} heading={<header>
        <h2>{t("workspace.title")}</h2>
      </header>} />
      <footer>
        <ApiStatus />
      </footer>
    </aside>
  );
}
