import { useState } from "react";
import { CheckCircle2, ChevronDown, ChevronRight, Circle, CircleAlert, Clock3, LoaderCircle, MoreHorizontal, Plus, Square, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PopoverMenu } from "../../shared/ui/popover-menu";
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const statusIcon = (status: string) => {
    const label = t(`multiAgent.${status}`, { defaultValue: status });
    const icon = status === "running" ? <LoaderCircle />
      : status === "completed" ? <CheckCircle2 />
        : status === "failed" ? <CircleAlert />
          : status === "stopped" ? <Square />
            : status === "pending" || status === "ready" ? <Clock3 /> : <Circle />;
    return <Tooltip content={label}><span className={`${styles.taskStatus} ${styles[`status_${status}`] ?? ""}`}>{icon}</span></Tooltip>;
  };
  const toggle = (agentId: string) => setExpanded((current) => {
    const next = new Set(current);
    if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
    return next;
  });
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
          <button className={styles.toggle} onClick={() => toggle(agent.id)}>{expanded.has(agent.id) ? <ChevronDown /> : <ChevronRight />}</button>
          <Tooltip content={agent.description}><button className={styles.agentName} onClick={() => props.onSelectAgent(agent.id)}><strong>{agent.name}</strong></button></Tooltip>
          <Tooltip content={t("multiAgent.runNewTask")}><button onClick={() => props.onRunAgent(agent.id)}><Plus /></button></Tooltip>
          <PopoverMenu trigger={<Tooltip content={t("projects.more")}><button aria-label={t("projects.more")}><MoreHorizontal /></button></Tooltip>}>
            <button className={styles.danger} onClick={() => props.onDeleteAgent(agent.id)}><Trash2 /><span>{t("projects.delete")}</span></button>
          </PopoverMenu>
        </div>
        {expanded.has(agent.id) && <div className={styles.tasks}>
          {!agent.tasks.length && <span>{t("multiAgent.emptyTasks")}</span>}
          {agent.tasks.map((task) => <div key={task.id} className={`${styles.task} ${task.id === props.selectedTaskId ? styles.active : ""}`}>
            <button onClick={() => props.onSelectTask(task.id)}><span>{task.title}</span></button>
            {statusIcon(task.status)}
            <button className={styles.deleteTask} onClick={() => props.onDeleteTask(task.id)}><Trash2 /></button>
          </div>)}
        </div>}
      </section>)}
    </div>
    <footer className={styles.footer}><ApiStatus /></footer>
  </aside>;
}
