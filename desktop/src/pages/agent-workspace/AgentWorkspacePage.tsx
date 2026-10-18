import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import { TaskSidebar } from "../../widgets/task-sidebar";
import { ConversationChat } from "../../features/conversation-chat";
import styles from "./AgentWorkspacePage.module.css";
import type { MessageLocation } from "../../entities/conversation/types";

export function AgentWorkspacePage() {
  const { t } = useTranslation();
  const [conversationId, setConversationId] = useState<string | null>(() => sessionStorage.getItem("ohmycode.activeConversationId"));
  const [refreshToken, setRefreshToken] = useState(0);
  const [searchLocation, setSearchLocation] = useState<MessageLocation>();

  function selectConversation(id: string, location?: MessageLocation) {
    sessionStorage.setItem("ohmycode.activeConversationId", id);
    setConversationId(id);
    setSearchLocation(location);
  }

  return (
    <AppShell
      navigation={<NavigationRail />}
      sidebar={<TaskSidebar
        selectedConversationId={conversationId}
        onConversationSelect={(_project, conversation, location) => selectConversation(conversation.id, location)}
        onConversationDelete={(deletedId) => {
          if (deletedId === conversationId) {
            sessionStorage.removeItem("ohmycode.activeConversationId");
            setConversationId(null);
          }
        }}
        refreshToken={refreshToken}
      />}
    >
      <section className={styles.content}>
        {conversationId && <div className={styles.conversationView}>
          <ConversationChat
            key={conversationId}
            active
            conversationId={conversationId}
            searchLocation={searchLocation}
            onUpdated={() => setRefreshToken((value) => value + 1)}
            onBranched={(conversation) => {
              setRefreshToken((value) => value + 1);
              selectConversation(conversation.id);
            }}
          />
        </div>}
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
