import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleX, FilePenLine, FileSearch, FileText, FolderOpen, Image, LoaderCircle, TerminalSquare } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../../../shared/ui/markdown-content";
import styles from "./ActivityTimeline.module.css";

function formatToolResult(value: unknown): string {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const result = value as Record<string, unknown>;
    if (typeof result.dataUrl === "string") {
      const metadata = Object.fromEntries(Object.entries(result).filter(([key]) => key !== "dataUrl"));
      return JSON.stringify(metadata, null, 2);
    }
    if (typeof result.operation === "string" && typeof result.output === "string") return result.output;
    if (typeof result.output === "string") {
      const suffix = result.status === "running"
        ? `\n\n[${String(result.status)} · terminal ${String(result.terminalId || "")}]`
        : `\n\n[exit ${String(result.exitCode ?? "-")}]`;
      return `${result.output}${suffix}`.trim();
    }
  }
  return value ? JSON.stringify(value, null, 2) : "";
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function pathName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || value;
}

function patchTarget(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/m)?.[1]?.trim() ?? "";
}

function toolFailed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(toolFailed);
  if (!value || typeof value !== "object") return false;
  const result = value as Record<string, unknown>;
  return typeof result.error === "string"
    || (typeof result.exitCode === "number" && result.exitCode !== 0);
}

function ToolStep({ step }: { step: Extract<AgentActivityStep, { type: "tool" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(step.status === "running");
  const input = parseToolInput(step.input);
  const action = String(input.action || (input.command ? "start" : step.tool));
  const command = input.command ? String(input.command) : `${action} ${String(input.terminalId || "")}`.trim();
  const result = formatToolResult(step.result);
  const failed = toolFailed(step.result);
  const metadata = step.result && typeof step.result === "object" && !Array.isArray(step.result)
    ? step.result as Record<string, unknown>
    : {};
  const resolvedFilePath = typeof metadata.path === "string" ? metadata.path : "";
  const requestedFilePath = typeof input.path === "string" ? input.path : patchTarget(input.patch);
  const clickableFilePath = resolvedFilePath || requestedFilePath;
  const imageReference = typeof input.imageUrl === "string" ? input.imageUrl : "";
  const projectId = typeof input.projectId === "string" ? input.projectId : undefined;
  const displayedFilePath = pathName(clickableFilePath || imageReference);
  const fileTool = ["read_file", "apply_patch", "search_files", "list_directory", "view_image"].includes(step.tool);
  const fileLabel = step.status === "running" ? t(({
    read_file: "agent.readingFile",
    apply_patch: "agent.editingFile",
    search_files: "agent.searchingFiles",
    list_directory: "agent.listingDirectory",
    view_image: "agent.viewingImage",
  })[step.tool] ?? "agent.usingFileTool") : t((failed ? {
    read_file: "agent.readFileFailed",
    apply_patch: "agent.editFileFailed",
    search_files: "agent.searchFilesFailed",
    list_directory: "agent.listDirectoryFailed",
    view_image: "agent.viewImageFailed",
  } : {
    read_file: "agent.readFile",
    apply_patch: "agent.editedFile",
    search_files: "agent.searchedFiles",
    list_directory: "agent.listedDirectory",
    view_image: "agent.viewedImage",
  })[step.tool] ?? "agent.usingFileTool");
  const FileIcon = step.tool === "read_file" ? FileText : step.tool === "apply_patch" ? FilePenLine : step.tool === "search_files" ? FileSearch : step.tool === "view_image" ? Image : FolderOpen;
  if (fileTool) return <div className={styles.step}>
    <div
      className={styles.fileStepHead}
      role="button"
      tabIndex={0}
      aria-expanded={open}
      onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        setOpen((value) => !value);
      }}
    >
      {step.status === "running" ? <LoaderCircle className={styles.spinner} /> : failed ? <CircleX className={styles.failed} /> : <Check />}
      <FileIcon />
      <span>{fileLabel}</span>
      {clickableFilePath
        ? <button
            className={styles.pathLink}
            type="button"
            title={resolvedFilePath || requestedFilePath}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void window.ohmycode.openPath(clickableFilePath, projectId);
            }}
          >{displayedFilePath}</button>
        : displayedFilePath ? <span>{displayedFilePath}</span> : null}
      <button className={styles.expandButton} type="button" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}><ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} /></button>
    </div>
    {open && result && <pre className={styles.output}>{result}</pre>}
  </div>;
  return <div className={styles.step}>
    <button className={styles.stepHead} type="button" onClick={() => setOpen((value) => !value)}>
      {step.status === "running" ? <LoaderCircle className={styles.spinner} /> : failed ? <CircleX className={styles.failed} /> : <Check />}
      <TerminalSquare />
      <span>{step.status === "running" ? t("agent.runningCommand") : failed ? t("agent.commandFailed") : t("agent.ranCommand")}</span>
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
    {open && <div className={styles.reasoning}><MarkdownContent>{step.content}</MarkdownContent></div>}
  </div>;
}

function MessageStep({ step }: { step: Extract<AgentActivityStep, { type: "message" }> }) {
  if (!step.content) return null;
  return <div className={styles.progressMessage}><MarkdownContent>{step.content}</MarkdownContent></div>;
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
