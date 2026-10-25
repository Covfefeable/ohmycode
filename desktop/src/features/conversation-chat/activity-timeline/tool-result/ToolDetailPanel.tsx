import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, CodeXml, Copy, Maximize2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { IconButton } from "../../../../shared/ui/icon-button";
import { Tooltip } from "../../../../shared/ui/tooltip";
import { ValueTree } from "./ValueTree";
import styles from "./ToolDetailPanel.module.css";

export function ToolDetailPanel({ input, result, children }: { input: Record<string, unknown>; result: unknown; children: ReactNode }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"result" | "input">("result");
  const [raw, setRaw] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [copiedText, setCopiedText] = useState<string>();
  const [copyFailed, setCopyFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const value = tab === "input" ? input : result;
  const text = useMemo(() => typeof value === "string" ? value : JSON.stringify(value, null, 2) ?? "", [value]);
  const copied = copiedText === text;
  useEffect(() => {
    if (!expanded) return;
    const previous = document.activeElement as HTMLElement | null;
    dialog.current!.showModal();
    return () => previous?.focus();
  }, [expanded]);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopiedText(text); setCopyFailed(false); }
    catch { setCopyFailed(true); }
  }
  const panel = <div className={`${styles.panel} ${expanded ? styles.expanded : ""}`}>
    <header className={styles.toolbar}>
      <div className={styles.tabs} role="tablist" aria-label={t("agent.toolDetails")}>
        {(["result", "input"] as const).map((item) => <button key={item} id={`${id}-${item}`} role="tab" type="button" aria-selected={tab === item} aria-controls={`${id}-body`} onClick={() => setTab(item)}>{t(item === "result" ? "agent.toolResult" : "agent.toolInput")}</button>)}
      </div>
      <div className={styles.actions}>
        <Tooltip content={t("agent.toolRaw")}><IconButton active={raw} aria-pressed={raw} aria-label={t("agent.toolRaw")} onClick={() => setRaw((current) => !current)}><CodeXml /></IconButton></Tooltip>
        <Tooltip content={t(copied ? "common.copied" : "common.copy")}><IconButton aria-label={t("common.copy")} onClick={() => void copy()}>{copied ? <Check /> : <Copy />}</IconButton></Tooltip>
        <Tooltip content={t(expanded ? "common.close" : "agent.toolExpand")}><IconButton aria-label={t(expanded ? "common.close" : "agent.toolExpand")} onClick={() => setExpanded((current) => !current)}>{expanded ? <X /> : <Maximize2 />}</IconButton></Tooltip>
      </div>
    </header>
    {copyFailed && <p className={styles.error} role="alert">{t("debug.copyFailed")}</p>}
    <div id={`${id}-body`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className={styles.body}>
      {raw ? <pre className={styles.raw}>{text}</pre> : tab === "input" ? <ValueTree value={input} /> : children}
    </div>
  </div>;
  return expanded ? createPortal(<dialog ref={dialog} className={styles.dialog} aria-modal="true" aria-label={t("agent.toolDetails")} onCancel={(event) => { event.preventDefault(); setExpanded(false); }}>{panel}</dialog>, document.body) : panel;
}
