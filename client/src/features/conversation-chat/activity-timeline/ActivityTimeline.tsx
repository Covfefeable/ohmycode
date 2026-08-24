import { useEffect, useState } from "react";
import { Check, ChevronDown, LoaderCircle, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import styles from "./ActivityTimeline.module.css";

function formatToolResult(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = value as Record<string, unknown>;
    if (typeof result.output === "string") {
      const suffix = result.status === "running"
        ? `\n\n[${String(result.status)} · terminal ${String(result.terminalId || "")}]`
        : `\n\n[exit ${String(result.exitCode ?? "-")}]`;
      return `${result.output}${suffix}`.trim();
    }
  }
  return value ? JSON.stringify(value, null, 2) : "";
}

function ToolStep({ step }: { step: Extract<AgentActivityStep, { type: "tool" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(step.status === "running");
  const input = (typeof step.input === "string" ? JSON.parse(step.input || "{}") : step.input) as Record<string, unknown>;
  const action = String(input.action || (input.command ? "start" : step.tool));
  const command = input.command ? String(input.command) : `${action} ${String(input.terminalId || "")}`.trim();
  const result = formatToolResult(step.result);
  return <div className={styles.step}>
    <button className={styles.stepHead} type="button" onClick={() => setOpen((value) => !value)}>
      {step.status === "running" ? <LoaderCircle className={styles.spinner} /> : <Check />}
      <TerminalSquare />
      <span>{step.status === "running" ? t("agent.runningCommand") : t("agent.ranCommand")}</span>
      <code>{command}</code>
      <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
    </button>
    {open && result && <pre className={styles.output}>{result}</pre>}
  </div>;
}

function ReasoningStep({ step }: { step: Extract<AgentActivityStep, { type: "reasoning" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(step.status === "running");
  return <div className={styles.step}>
    <button className={styles.stepHead} type="button" onClick={() => setOpen((value) => !value)}>
      {step.status === "running" ? <LoaderCircle className={styles.spinner} /> : <Check />}
      <span>{t(step.status === "running" ? "agent.thinking" : "agent.thought")}</span>
      <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
    </button>
    {open && <div className={styles.reasoning}><ReactMarkdown remarkPlugins={[remarkGfm]}>{step.content}</ReactMarkdown></div>}
  </div>;
}

function MessageStep({ step }: { step: Extract<AgentActivityStep, { type: "message" }> }) {
  if (!step.content) return null;
  return <div className={styles.progressMessage}><ReactMarkdown remarkPlugins={[remarkGfm]}>{step.content}</ReactMarkdown></div>;
}

function ActivityStep({ step }: { step: AgentActivityStep }) {
  if (step.type === "run") return null;
  if (step.type === "reasoning") return <ReasoningStep step={step} />;
  if (step.type === "message") return <MessageStep step={step} />;
  return <ToolStep step={step} />;
}

function RunSection({ steps, active, duration }: { steps: AgentActivityStep[]; active: boolean; duration?: string }) {
  const { t } = useTranslation();
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = active || manuallyOpen;
  return <div className={styles.runSection}>
    <button className={styles.summary} type="button" onClick={() => setManuallyOpen((value) => !value)}>
      {active ? <LoaderCircle className={styles.spinner} /> : <Check />}
      <span>{active ? t("agent.working") : duration ?? t("agent.steps")}</span>
      <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
    </button>
    {open && <div className={styles.steps}>{steps.map((step) => <ActivityStep key={`${step.id}-${step.status}`} step={step} />)}</div>}
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
    return <RunSection key={`${run[0]?.id ?? "run"}-${index}`} steps={run} active={active && isLast} duration={isLast && hasDuration ? duration : undefined} />;
  })}</div>;
}
