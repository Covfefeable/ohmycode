import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActivityTimeline } from "../../features/conversation-chat/activity-timeline/ActivityTimeline";
import { withoutFinalResponse } from "../../features/conversation-chat/activity-timeline/updateActivity";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import styles from "./MultiAgentPage.module.css";

type Props = { member: MultiAgentMemberData; liveActivity?: AgentActivityStep[]; onClose(): void };

export function ActivityDrawer({ member, liveActivity, onClose }: Props) {
  const { t } = useTranslation();
  const persisted = (member.finalOutput?.activity as AgentActivityStep[] | undefined) ?? [];
  const finalText = typeof member.finalOutput?.content === "string" ? member.finalOutput.content : "";
  const steps = withoutFinalResponse(liveActivity ?? persisted, finalText);
  return <aside className={styles.activityDrawer}>
    <button className={styles.close} onClick={onClose}><X /></button>
    <h2>{member.name}</h2>
    <p>{member.role}</p>
    {steps.length
      ? <ActivityTimeline steps={steps} active={member.status === "running"} durationMs={member.agentDurationMs} startedAt={member.agentStartedAt ?? undefined} />
      : <span className={styles.noActivity}>{t("multiAgent.waitingForActivity")}</span>}
    {finalText && <div className={styles.finalOutput}><MarkdownContent>{finalText}</MarkdownContent></div>}
  </aside>;
}
