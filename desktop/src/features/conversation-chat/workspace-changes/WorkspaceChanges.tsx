import { lazy, Suspense, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { FileCode2, History, Info, RefreshCw, RotateCcw, Undo2, X } from "lucide-react";
import type { WorkspaceChangeSet } from "../../../../contracts/domain";
import { IconButton } from "../../../shared/ui/icon-button";
import { ConfirmDialog } from "../../../shared/ui/confirm-dialog";
import { Tooltip } from "../../../shared/ui/tooltip";
import { useSidePanelResize } from "../../../shared/hooks/useSidePanelResize";
import { useFeedback } from "../../feedback";
import styles from "./WorkspaceChanges.module.css";

const FileDiffViewer = lazy(() => import("../activity-timeline/file-diff-viewer/FileDiffViewer").then((module) => ({ default: module.FileDiffViewer })));
type FileTab = { key: string; id: string; file: string; version: number; loading: boolean; detail?: { path: string; original: string; modified: string } };

export function WorkspaceChanges({ conversationId, sending, records, failed, refresh, active, onClose }: {
  conversationId: string; sending: boolean; records: WorkspaceChangeSet[]; failed: boolean; refresh(): void; active: boolean; onClose(): void;
}) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const panel = useRef<HTMLElement>(null);
  const resize = useSidePanelResize(panel, active, "ohmycode.workspaceChangesWidth");
  const [tabState, setTabState] = useState<{ tabs: FileTab[]; active?: string }>({ tabs: [] });
  const { tabs, active: activeTab } = tabState;
  const [selection, setSelection] = useState<{ id: string; file?: string; count?: number }>();
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  const selectedTab = tabs.find((tab) => tab.key === activeTab);
  const excluded = [...new Set(records.flatMap((record) => record.excluded))];
  async function show(id: string, file: string) {
    const key = `${id}:${file}`;
    if (tabs.some((tab) => tab.key === key)) { setTabState((current) => ({ ...current, active: key })); return; }
    const version = ++request.current;
    setTabState((current) => ({ tabs: [...current.tabs, { key, id, file, version, loading: true }], active: key }));
    try {
      const detail = await window.ohmycode.conversations.snapshotDetail(conversationId, id, file);
      setTabState((current) => ({ ...current, tabs: current.tabs.map((tab) => tab.key === key && tab.version === version ? { ...tab, detail, loading: false } : tab) }));
    } catch {
      setTabState((current) => ({ ...current, tabs: current.tabs.map((tab) => tab.key === key && tab.version === version ? { ...tab, loading: false } : tab) }));
      toast({ type: "error", message: t("snapshots.previewFailed") });
    }
  }
  function closeTab(key: string) {
    setTabState((current) => {
      const remaining = current.tabs.filter((tab) => tab.key !== key);
      return { tabs: remaining, active: current.active === key ? remaining.at(-1)?.key : current.active };
    });
  }
  async function restore() {
    if (!selection) return;
    setBusy(true);
    try {
      if (selection.file !== undefined) {
        await window.ohmycode.conversations.restoreFile(conversationId, selection.id, selection.file);
        closeTab(`${selection.id}:${selection.file}`);
      } else {
        await window.ohmycode.conversations.restoreTurn(conversationId, selection.id);
        setTabState((current) => {
          const remaining = current.tabs.filter((tab) => tab.id !== selection.id);
          return { tabs: remaining, active: remaining.some((tab) => tab.key === current.active) ? current.active : remaining.at(-1)?.key };
        });
      }
      setSelection(undefined); refresh();
      toast({ type: "success", message: t("snapshots.restored") });
    } catch { refresh(); toast({ type: "error", message: t("snapshots.restoreFailed") }); }
    finally { setBusy(false); }
  }
  return <>
    <aside ref={panel} className={styles.panel} aria-label={t("snapshots.title")} style={{ "--browser-panel-width": resize.width ? `${resize.width}px` : undefined } as CSSProperties}>
      <div className={styles.resizeHandle} role="separator" tabIndex={0} aria-label={t("snapshots.resize")} aria-orientation="vertical" aria-valuenow={resize.width ? Math.round(resize.width) : undefined} onPointerDown={resize.start} onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault(); resize.nudge(event.key === "ArrowLeft" ? 1 : -1);
      }} />
      <header className={styles.header}><div className={styles.heading}><History /><span>{t("snapshots.title")}</span></div><div className={styles.actions}>
        <Tooltip content={t("snapshots.refresh")}><IconButton aria-label={t("snapshots.refresh")} onClick={refresh}><RefreshCw /></IconButton></Tooltip>
        <Tooltip content={t("snapshots.close")}><IconButton aria-label={t("snapshots.close")} onClick={onClose}><X /></IconButton></Tooltip>
      </div></header>
      {failed && <p className={styles.error} role="alert">{t("snapshots.loadFailed")}</p>}
      <div className={`${styles.list} ${tabs.length ? styles.compact : ""}`}>
        {records.map((record) => <section key={record.id} className={styles.record}>
          <div className={styles.recordHeading}>
            <Tooltip className={styles.recordRequest} content={record.userRequest || t("snapshots.requestUnavailable")}><span>{record.userRequest || t("snapshots.requestUnavailable")}</span></Tooltip>
            <time dateTime={record.createdAt}>{new Date(record.createdAt).toLocaleString()}</time>
            <Tooltip content={t("snapshots.restoreAll")}><IconButton aria-label={`${t("snapshots.restoreAll")}: ${record.userRequest || t("snapshots.requestUnavailable")}`} disabled={sending || busy || record.status !== "ready"} onClick={() => setSelection({ id: record.id, count: record.files.filter((file) => !file.restored).length })}><RotateCcw /></IconButton></Tooltip>
          </div>
          {record.status !== "ready" && <span className={styles.status}>{t(`snapshots.${record.status}`)}</span>}
          {record.status === "unavailable" && <p className={styles.error}>{t("snapshots.unavailableDescription")}</p>}
          {record.files.filter((file) => !file.restored).map((file) => <div key={file.path} className={`${styles.file} ${activeTab === `${record.id}:${file.path}` ? styles.selected : ""}`}>
            <Tooltip className={styles.fileTrigger} content={`${t(`snapshots.${file.operation}`)}: ${file.path}`}><button className={styles.fileName} aria-label={file.path} onClick={() => void show(record.id, file.path)}><FileCode2 className={styles[file.operation]} /><span className={styles.fileText}><strong>{file.path.split(/[\\/]/).at(-1)}</strong><small>{file.path.split(/[\\/]/).slice(0, -1).join("/") || "."}</small></span></button></Tooltip>
            <Tooltip content={t(`snapshots.${file.operation}`)}><span className={`${styles.operation} ${styles[file.operation]}`}>{t(`snapshots.${file.operation}Code`)}</span></Tooltip>
            <Tooltip content={t("snapshots.restore")}><IconButton aria-label={`${t("snapshots.restore")}: ${file.path}`} disabled={sending || busy || record.status !== "ready"} onClick={() => setSelection({ id: record.id, file: file.path })}><Undo2 /></IconButton></Tooltip>
          </div>)}
        </section>)}
      </div>
      {tabs.length > 0 && <>
        <div className={styles.tabs} role="tablist" aria-label={t("snapshots.openFiles")}>{tabs.map((tab) => <div className={`${styles.tab} ${tab.key === activeTab ? styles.selected : ""}`} key={tab.key}>
          <Tooltip content={tab.file}><button role="tab" id={`change-tab-${tab.version}`} aria-controls={`change-preview-${tab.version}`} aria-selected={tab.key === activeTab} onClick={() => setTabState((current) => ({ ...current, active: tab.key }))}>{tab.file.split(/[\\/]/).at(-1)}</button></Tooltip>
          <Tooltip content={t("snapshots.closeFile")}><IconButton aria-label={`${t("snapshots.closeFile")}: ${tab.file}`} onClick={() => closeTab(tab.key)}><X /></IconButton></Tooltip>
        </div>)}</div>
        {selectedTab && <div className={styles.preview} role="tabpanel" id={`change-preview-${selectedTab.version}`} aria-labelledby={`change-tab-${selectedTab.version}`}>{selectedTab.loading ? <p>{t("agent.loadingDiff")}</p> : selectedTab.detail ? <Suspense fallback={<p>{t("agent.loadingDiff")}</p>}><FileDiffViewer key={selectedTab.key} changes={[selectedTab.detail]} /></Suspense> : <p>{t("snapshots.previewFailed")}</p>}</div>}
      </>}
      {excluded.length > 0 && <details className={styles.excluded}><summary><Info /><span>{t("snapshots.excluded", { count: excluded.length })}</span></summary><p>{t("snapshots.excludedDescription")}</p><ul>{excluded.map((file) => <li key={file}>{file}</li>)}</ul></details>}
    </aside>
    <ConfirmDialog open={Boolean(selection)} title={t(selection?.file !== undefined ? "snapshots.restore" : "snapshots.restoreAll")} description={selection?.file !== undefined ? t("snapshots.confirm", { file: selection.file }) : t("snapshots.confirmAll", { count: selection?.count })} confirmLabel={t(selection?.file !== undefined ? "snapshots.restore" : "snapshots.restoreAll")} busy={busy} onCancel={() => setSelection(undefined)} onConfirm={() => void restore()} />
  </>;
}
