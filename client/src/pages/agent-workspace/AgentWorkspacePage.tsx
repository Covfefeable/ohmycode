import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import { TaskSidebar } from "../../widgets/task-sidebar";
import { TaskComposer } from "../../features/task-composer";
import styles from "./AgentWorkspacePage.module.css";

export function AgentWorkspacePage() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useState<string | null>(null);

  return (
    <AppShell
      navigation={<NavigationRail />}
      sidebar={<TaskSidebar workspace={workspace} onWorkspaceChange={setWorkspace} />}
    >
      <section className={styles.content}>
        <div className={styles.welcome}>
          <div className={styles.promptMark}>›_</div>
          <p className={styles.eyebrow}>{t("agent.eyebrow")}</p>
          <h1>{t("agent.heading")}</h1>
          <p className={styles.description}>{t("agent.description")}</p>
          <TaskComposer disabled={!workspace} />
        </div>
      </section>
    </AppShell>
  );
}
