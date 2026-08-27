import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import { TaskSidebar } from "../../widgets/task-sidebar";
import { ConversationChat } from "../../features/conversation-chat";
import styles from "./AgentWorkspacePage.module.css";

export function AgentWorkspacePage() {
  const { t } = useTranslation();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [openedConversationIds, setOpenedConversationIds] = useState<string[]>([]);
  const [refreshToken, setRefreshToken] = useState(0);

  function selectConversation(id: string) {
    setOpenedConversationIds((items) => items.includes(id) ? items : [...items, id]);
    setConversationId(id);
  }

  return (
    <AppShell
      navigation={<NavigationRail />}
      sidebar={<TaskSidebar
        selectedConversationId={conversationId}
        onConversationSelect={(_project, conversation) => selectConversation(conversation.id)}
        onConversationDelete={(deletedId) => {
          setOpenedConversationIds((items) => items.filter((id) => id !== deletedId));
          if (deletedId === conversationId) setConversationId(null);
        }}
        refreshToken={refreshToken}
      />}
    >
      <section className={styles.content}>
        {openedConversationIds.map((id) => <div className={styles.conversationView} hidden={id !== conversationId} key={id}>
          <ConversationChat active={id === conversationId} conversationId={id} onUpdated={() => setRefreshToken((value) => value + 1)} />
        </div>)}
        {!conversationId && <div className={styles.welcome}>
          <div className={styles.promptMark}>›_</div>
          <p className={styles.eyebrow}>{t("agent.eyebrow")}</p>
          <h1>{t("agent.heading")}</h1>
          <p className={styles.description}>{t("agent.description")}</p>
        </div>}
      </section>
    </AppShell>
  );
}
