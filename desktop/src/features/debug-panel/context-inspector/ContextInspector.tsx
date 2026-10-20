import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Copy, RefreshCw, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ContextSnapshot } from "../../../../electron/debug/types";
import { IconButton } from "../../../shared/ui/icon-button";
import { Tooltip } from "../../../shared/ui/tooltip";
import { useFeedback } from "../../feedback";
import styles from "./ContextInspector.module.css";
import debugStyles from "../DebugPanel.module.css";

const ContextJson = lazy(() => import("./ContextJson"));
type Tab = "messages" | "tools" | "request";

export function ContextInspector({ conversationId, onClose }: { conversationId: string; onClose(): void }) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const dialog = useRef<HTMLElement>(null);
  const [data, setData] = useState<ContextSnapshot>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [tab, setTab] = useState<Tab>("messages");
  useEffect(() => {
    let active = true;
    void window.ohmycode.debug.contextSnapshot(conversationId).then((next) => {
      if (active) setData(next);
    }).catch(() => { if (active) setFailed(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [conversationId, revision]);
  function refresh() {
    setLoading(true);
    setFailed(false);
    setRevision((current) => current + 1);
  }
  useEffect(() => {
    dialog.current?.focus();
  }, []);
  const snapshot = data?.snapshot;
  const value = snapshot ? JSON.stringify(tab === "messages" ? snapshot.body.messages : tab === "tools" ? snapshot.body.tools ?? [] : snapshot.body, null, 2) : "";
  const input = snapshot?.usage?.prompt_tokens ?? snapshot?.usage?.input_tokens;
  const cached = snapshot?.usage?.prompt_tokens_details?.cached_tokens ?? snapshot?.usage?.prompt_cache_hit_tokens;
  const unknown = t("debug.notProvided");
  const number = (value: number | undefined) => value === undefined ? unknown : value.toLocaleString(i18n.language);
  const metrics = snapshot ? [
    [t("debug.requestModel"), snapshot.body.model],
    [t("debug.requestStatus"), t(`debug.status.${snapshot.status}`)],
    [t("debug.requestStep"), String(snapshot.step + 1)],
    [t("debug.estimatedTokens"), number(snapshot.estimatedTokens)],
    [t("debug.actualTokens"), number(input)],
    [t("debug.cachedTokens"), number(cached)],
    [t("debug.occupancy"), `${((input ?? snapshot.estimatedTokens) / snapshot.contextLength * 100).toFixed(1)}% / ${number(snapshot.contextLength)}`],
    [t("debug.messageCount"), number(snapshot.messageCount)],
    [t("debug.toolCount"), number(snapshot.toolCount)],
    [t("debug.requestSize"), `${(snapshot.requestBytes / 1024).toFixed(1)} KiB`],
    [t("debug.compacted"), t(snapshot.compacted ? "debug.yes" : "debug.no")],
  ] : [];
  async function copy() {
    try { await navigator.clipboard.writeText(value); toast({ type: "success", message: t("common.copied") }); }
    catch { toast({ type: "error", message: t("debug.copyFailed") }); }
  }
  return <div className={debugStyles.backdrop} onMouseDown={onClose}>
    <section ref={dialog} tabIndex={-1} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="context-title" onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); }
    }}>
      <header className={styles.header}>
        <div><h2 id="context-title">{data?.title ?? t("debug.viewContext")}</h2>{snapshot && <time dateTime={snapshot.capturedAt}>{new Date(snapshot.capturedAt).toLocaleString(i18n.language)}</time>}</div>
        <div className={styles.actions}>
          <Tooltip content={t("debug.refresh")}><IconButton disabled={loading} aria-label={t("debug.refresh")} aria-busy={loading} onClick={refresh}><RefreshCw /></IconButton></Tooltip>
          <Tooltip content={t("common.copy")}><IconButton disabled={!snapshot} aria-label={t("common.copy")} onClick={() => void copy()}><Copy /></IconButton></Tooltip>
          <Tooltip content={t("common.close")}><IconButton aria-label={t("common.close")} onClick={onClose}><X /></IconButton></Tooltip>
        </div>
      </header>
      {failed && <div className={styles.notice} role="alert">{t("debug.loadFailed")}</div>}
      {loading && !data && <div className={styles.empty} role="status">{t("debug.loading")}</div>}
      {!loading && data && !snapshot && <div className={styles.empty}>{t("debug.noSnapshot")}</div>}
      {snapshot && <>
        <dl className={styles.metrics}>{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
        <div className={styles.tabs} role="tablist">{(["messages", "tools", "request"] as const).map((item) => <button key={item} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)}>{t(`debug.tabs.${item}`)}</button>)}</div>
        <div className={styles.editor} role="tabpanel"><Suspense fallback={<div className={styles.empty}>{t("debug.loading")}</div>}><ContextJson value={value} /></Suspense></div>
        <footer className={styles.footer}>{t("debug.snapshotHint")}</footer>
      </>}
    </section>
  </div>;
}
