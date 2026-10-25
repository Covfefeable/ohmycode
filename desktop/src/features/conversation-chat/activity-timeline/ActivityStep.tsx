import { mcpToolDisplayName } from "@ohmycode/tool-contracts";
import { Check, ChevronDown, CircleX, FilePenLine, FileSearch, FileText, FolderOpen, Image, LoaderCircle, TerminalSquare, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../../../shared/ui/markdown-content";
import { presentToolActivity } from "./tool-presentation";
import { useActivityExpansion } from "./expansion-state";
import { ToolResultView } from "./ToolResultView";
import styles from "./ActivityTimeline.module.css";

function ToolStep({ step }: { step: Extract<AgentActivityStep, { type: "tool" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useActivityExpansion(`${step.id}-${step.status}`, step.status === "running");
  const presentation = presentToolActivity(step.tool, step.input, step.result);
  const { command, displayResource: displayedFilePath, failed, projectId, resource: clickableFilePath, result } = presentation;
  const fileLabelKey = step.status === "running"
    ? presentation.labels?.running
    : failed ? presentation.labels?.failed : presentation.labels?.completed;
  const FileIcon = presentation.icon === "file" ? FileText : presentation.icon === "edit" ? FilePenLine : presentation.icon === "search" ? FileSearch : presentation.icon === "image" ? Image : FolderOpen;
  if (presentation.kind === "file") return <div className={styles.step}>
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
      <span>{t(fileLabelKey ?? "agent.usingFileTool")}</span>
      {clickableFilePath
        ? <button
            className={styles.pathLink}
            type="button"
            title={clickableFilePath}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void window.ohmycode.openPath(clickableFilePath, projectId);
            }}
          >{displayedFilePath}</button>
        : displayedFilePath ? <span>{displayedFilePath}</span> : null}
      <button className={styles.expandButton} type="button" aria-expanded={open} onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}><ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} /></button>
    </div>
    {open && <ToolResultView presentation={presentation} completed={step.status === "completed"} />}
  </div>;
  const genericTool = presentation.kind === "generic";
  const GenericIcon = genericTool ? Wrench : TerminalSquare;
  return <div className={styles.step}>
    <button className={styles.stepHead} type="button" onClick={() => setOpen((value) => !value)}>
      {step.status === "running" ? <LoaderCircle className={styles.spinner} /> : failed ? <CircleX className={styles.failed} /> : <Check />}
      <GenericIcon />
      <span>{genericTool
        ? t(step.status === "running" ? "agent.usingTool" : failed ? "agent.toolFailed" : "agent.usedTool")
        : t(step.status === "running" ? "agent.runningCommand" : failed ? "agent.commandFailed" : "agent.ranCommand")}</span>
      <code>{genericTool ? mcpToolDisplayName(step.tool) : command}</code>
      <ChevronDown className={`${styles.chevron} ${open ? styles.chevronOpen : ""}`} />
    </button>
    {open && result && <pre className={styles.output}>{result}</pre>}
  </div>;
}

function ReasoningStep({ step }: { step: Extract<AgentActivityStep, { type: "reasoning" }> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useActivityExpansion(`${step.id}-${step.status}`, step.status === "running");
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

function ContextStep({ step }: { step: Extract<AgentActivityStep, { type: "context" }> }) {
  const { t } = useTranslation();
  return <div className={styles.step}>
    <div className={styles.contextStep}>
      {step.status === "running" ? <LoaderCircle className={styles.spinner} /> : <Check />}
      <span>{t(step.status === "running" ? "agent.compactingContext" : "agent.compactedContext")}</span>
    </div>
  </div>;
}

export function ActivityStep({ step }: { step: AgentActivityStep }) {
  if (step.type === "run" || step.type === "task_plan") return null;
  if (step.type === "reasoning") return <ReasoningStep step={step} />;
  if (step.type === "message") return <MessageStep step={step} />;
  if (step.type === "context") return <ContextStep step={step} />;
  return <ToolStep step={step} />;
}
