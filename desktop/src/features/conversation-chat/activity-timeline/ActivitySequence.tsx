import { ChevronDown, CircleX, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ActivityStep } from "./ActivityStep";
import { activitySummaryKeys, groupActivitySteps, type ActivityEntry } from "./activity-groups";
import { useActivityExpansion } from "./expansion-state";
import { toolResultFailed } from "./tool-presentation";
import styles from "./ActivityTimeline.module.css";

function ExecutionGroup({ group }: { group: Extract<ActivityEntry, { type: "group" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useActivityExpansion(group.id, false);
  const running = group.steps.some((step) => step.status === "running");
  const failed = group.steps.some((step) => step.type === "tool" && toolResultFailed(step.result));
  const summary = activitySummaryKeys(group.steps).map((key) => t(key)).join(t("agent.groupSeparator"));
  return <div className={styles.executionGroup}>
    <button className={styles.groupHead} type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ChevronDown className={`${styles.groupChevron} ${open ? styles.chevronOpen : ""}`} />
      <span>{summary}</span>
      {running ? <LoaderCircle className={styles.spinner} /> : failed ? <CircleX className={styles.failed} aria-label={t("agent.toolFailed")} /> : null}
    </button>
    {open && <div className={`${styles.steps} ${styles.groupSteps}`}>{group.steps.map((step) => <ActivityStep key={`${step.id}-${step.status}`} step={step} />)}</div>}
  </div>;
}

export function ActivitySequence({ steps }: { steps: AgentActivityStep[] }) {
  return <div className={styles.steps}>{groupActivitySteps(steps).map((entry) => entry.type === "message"
    ? <ActivityStep key={entry.id} step={entry} />
    : <ExecutionGroup key={entry.id} group={entry} />)}</div>;
}
