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
  const [refreshToken, setRefreshToken] = useState(0);

  return (
    <AppShell
      navigation={<NavigationRail />}
      sidebar={<TaskSidebar
        selectedConversationId={conversationId}
        onConversationSelect={(_project, conversation) => setConversationId(conversation.id)}
        onConversationDelete={(deletedId) => { if (deletedId === conversationId) setConversationId(null); }}
        refreshToken={refreshToken}
      />}
    >
      <section className={styles.content}>
        {conversationId ? <ConversationChat key={conversationId} conversationId={conversationId} onUpdated={() => setRefreshToken((value) => value + 1)} /> : <div className={styles.welcome}>
          <div className={styles.promptMark}>›_</div>
          <p className={styles.eyebrow}>{t("agent.eyebrow")}</p>
          <h1>{t("agent.heading")}</h1>
          <p className={styles.description}>{t("agent.description")}</p>
        </div>}
      </section>
    </AppShell>
  );
}
