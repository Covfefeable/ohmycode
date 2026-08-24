import { ChevronDown, FolderKanban, Plus, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import { ApiStatus } from "../api-status";
import styles from "./MultiAgentSidebar.module.css";

type Props = {
  agents: MultiAgentSummary[];
  selectedAgentId: string | null;
  selectedTaskId: string | null;
  busy: boolean;
  onCreateAgent(): void;
  onSelectAgent(agentId: string): void;
  onRunAgent(agentId: string): void;
  onSelectTask(taskId: string): void;
  onDeleteAgent(agentId: string): void;
  onDeleteTask(taskId: string): void;
};

export function MultiAgentSidebar(props: Props) {
  const { t } = useTranslation();
  return <aside className={styles.sidebar}>
    <div className={styles.sticky}>
      <p className={styles.eyebrow}>{t("workspace.productName")}</p>
      <h2>{t("multiAgent.title")}</h2>
      <button className={styles.create} disabled={props.busy} onClick={props.onCreateAgent}><Plus />{t("multiAgent.createCollaboration")}</button>
      <p className={styles.label}>{t("multiAgent.collaborations")}</p>
    </div>
    <div className={styles.list}>
      {!props.agents.length && <p className={styles.empty}>{t("multiAgent.emptyAgents")}</p>}
      {props.agents.map((agent) => <section key={agent.id} className={styles.agent}>
        <div className={`${styles.agentRow} ${agent.id === props.selectedAgentId && !props.selectedTaskId ? styles.agentActive : ""}`}>
          <ChevronDown />
          <FolderKanban />
          <Tooltip content={agent.description}><button className={styles.agentName} onClick={() => props.onSelectAgent(agent.id)}><strong>{agent.name}</strong></button></Tooltip>
          <Tooltip content={t("multiAgent.runNewTask")}><button onClick={() => props.onRunAgent(agent.id)}><Plus /></button></Tooltip>
          <Tooltip content={t("projects.delete")}><button onClick={() => props.onDeleteAgent(agent.id)}><Trash2 /></button></Tooltip>
        </div>
        <div className={styles.tasks}>
          {!agent.tasks.length && <span>{t("multiAgent.emptyTasks")}</span>}
          {agent.tasks.map((task) => <div key={task.id} className={`${styles.task} ${task.id === props.selectedTaskId ? styles.active : ""}`}>
            <button onClick={() => props.onSelectTask(task.id)}><span>{task.title}</span><small>{t(`multiAgent.${task.status}`, { defaultValue: task.status })}</small></button>
            <button className={styles.deleteTask} onClick={() => props.onDeleteTask(task.id)}><Trash2 /></button>
          </div>)}
        </div>
      </section>)}
    </div>
    <footer className={styles.footer}><ApiStatus /></footer>
  </aside>;
}
