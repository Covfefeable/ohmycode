import { useEffect, useState } from "react";
import { Check, ChevronDown, Circle, ListChecks, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActivitySequence } from "./ActivitySequence";
import { useActivityExpansion } from "./expansion-state";
import styles from "./ActivityTimeline.module.css";

function RunSection({ steps, active, duration }: { steps: AgentActivityStep[]; active: boolean; duration?: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useActivityExpansion(`run-${steps[0]?.id}-${active ? "active" : "completed"}`, active);
  const plan = [...steps].reverse().find((step): step is Extract<AgentActivityStep, { type: "task_plan" }> => step.type === "task_plan");
  return <div className={styles.runSection}>
    <button className={styles.runStatus} type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      {active ? <LoaderCircle className={styles.spinner} /> : <Check />}
      <span>{active ? t("agent.working") : duration ?? t("agent.steps")}</span>
      <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
    </button>
    {open && <div className={styles.steps}>
      {plan && <div className={styles.taskList}>
        <div className={styles.taskListLabel}><ListChecks /><span>{t("agent.taskList")}</span></div>
        {plan.tasks.map((task) => {
          const StatusIcon = task.status === "completed" ? Check : task.status === "in_progress" ? LoaderCircle : Circle;
          return <div key={task.id} className={styles.taskHead}>
            <StatusIcon className={task.status === "in_progress" ? styles.spinner : undefined} />
            <span>{task.content}</span>
          </div>;
        })}
      </div>}
      <ActivitySequence steps={steps} />
    </div>}
  </div>;
}

export function ActivityTimeline({ steps, active, durationMs, startedAt }: { steps: AgentActivityStep[]; active: boolean; durationMs?: number | null; startedAt?: string }) {
  const { t } = useTranslation();
  const [liveDuration, setLiveDuration] = useState(() => startedAt ? Date.now() - new Date(startedAt).getTime() : 0);
  useEffect(() => {
    if (!active || !startedAt) return;
    const update = () => setLiveDuration(Date.now() - new Date(startedAt).getTime());
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [active, startedAt]);
  if (!steps.length) return null;
  const hasDuration = durationMs != null || Boolean(startedAt);
  const seconds = Math.max(0, Math.round((durationMs ?? liveDuration) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const duration = hours > 0
    ? t("agent.durationHours", { hours, minutes, seconds: remainingSeconds })
    : minutes > 0 ? t("agent.durationMinutes", { minutes, seconds: remainingSeconds }) : t("agent.durationSeconds", { seconds });
  const runs: AgentActivityStep[][] = [];
  for (const step of steps) {
    if (step.type === "run") runs.push([]);
    else (runs.at(-1) ?? (runs[runs.length] = [])).push(step);
  }
  const visibleRuns = runs.filter((run) => run.length > 0);
  return <div className={styles.timeline}>{visibleRuns.map((run, index) => {
    const isLast = index === visibleRuns.length - 1;
    return <RunSection key={`${run[0]?.id ?? "run"}-${index}-${active && isLast ? "active" : "completed"}`} steps={run} active={active && isLast} duration={isLast && hasDuration ? duration : undefined} />;
  })}</div>;
}
