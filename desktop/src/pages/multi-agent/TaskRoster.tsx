import { Bot, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./MultiAgentPage.module.css";

type Props = {
  task: MultiAgentTask;
  selectedMemberId: string | null;
  running: boolean;
  onSelectMember(memberId: string): void;
  onStop(): void;
  onRerun(): void;
};

export function TaskRoster(props: Props) {
  const { t } = useTranslation();
  const rerunnable = ["failed", "stopped"].includes(props.task.status);
  return <aside className={styles.roster}>
    <div className={styles.rosterHeading}>
      <h2>{t("multiAgent.teamMembers")}</h2>
      <div className={styles.taskActions}>
        {props.running && <Tooltip content={t("multiAgent.stop")}><button aria-label={t("multiAgent.stop")} onClick={props.onStop}><Square /></button></Tooltip>}
        {rerunnable && <Tooltip content={t("multiAgent.rerun")}><button aria-label={t("multiAgent.rerun")} onClick={props.onRerun}><Play /></button></Tooltip>}
      </div>
    </div>
    {props.task.members.map((member) => <button key={member.id} className={props.selectedMemberId === member.id ? styles.selectedMember : ""} onClick={() => props.onSelectMember(member.id)}>
      <span className={styles.avatar}>{member.isHost ? <Bot /> : member.name.slice(0, 1)}</span>
      <span><strong>{member.name}</strong><small>{member.isHost ? t("multiAgent.host") : t(`multiAgent.${member.status}`, { defaultValue: member.status })}</small></span>
      <i className={`${styles.state} ${styles[member.status]}`} />
    </button>)}
  </aside>;
}
