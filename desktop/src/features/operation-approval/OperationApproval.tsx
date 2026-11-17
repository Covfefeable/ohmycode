import { useTranslation } from "react-i18next";
import { ArrowUpRight, Check, FolderOpen, LoaderCircle, ShieldQuestion, Terminal, X } from "lucide-react";
import type { useOperationApproval } from "./useOperationApproval";
import styles from "./OperationApproval.module.css";

type Approval = ReturnType<typeof useOperationApproval>;

export function OperationApproval({ approval }: { approval: Approval }) {
  const { t } = useTranslation();
  const request = approval.requests[0];
  if (!request && !approval.failed) return null;
  const terminal = request?.operation === "terminal" ? JSON.parse(request.details) as { command: string; cwd: string; input?: string } : undefined;
  const external = request?.operation === "external_file" ? JSON.parse(request.details) as { tool: string; path: string; arguments: { patch?: string } } : undefined;
  return <section className={styles.card} aria-live="polite">
    {approval.failed && <p role="alert">{t("agent.approvalFailed")}</p>}
    {request && <>
      <div className={styles.heading}><span className={styles.headingLabel}>{request.status === "checking" ? <LoaderCircle className={styles.spinner} /> : <ShieldQuestion />}<strong>{t(request.status === "checking" ? "agent.approvalChecking" : "agent.approvalTitle")}</strong></span>{approval.requests.length > 1 && <span className={styles.count}>{t("agent.approvalCount", { count: approval.requests.length })}</span>}</div>
      <div className={styles.operation}>
        <span className={styles.operationIcon}>{terminal ? <Terminal /> : <FolderOpen />}</span>
        <div className={styles.target}><div className={styles.operationTitle}><strong>{t(terminal ? "agent.approvalTerminal" : `agent.approvalFile_${external?.tool}`)}</strong>{external && <span className={styles.badge}><ArrowUpRight />{t("agent.approvalExternal")}</span>}</div><div className={styles.path}>{terminal?.cwd ?? external?.path ?? request.workspace}</div></div>
      </div>
      {terminal && <pre className={styles.command}>{terminal.command}{terminal.input !== undefined ? `\n\n${terminal.input}` : ""}</pre>}
      {external?.arguments.patch && <details className={styles.changes}><summary>{t("agent.approvalChanges")}</summary><pre>{external.arguments.patch}</pre></details>}
      {request.reason && <p className={styles.reason}>{request.reason}</p>}
      {request.status === "waiting" && <div className={styles.actions}><button type="button" onClick={() => void approval.reply(request.id, false)}><X />{t("agent.approvalReject")}</button><button type="button" className={styles.allow} onClick={() => void approval.reply(request.id, true)}><Check />{t("agent.approvalAllow")}</button></div>}
    </>}
  </section>;
}
