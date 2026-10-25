import { useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Globe, LoaderCircle, PanelRightClose, Plus, RotateCw, SquareArrowOutUpRight, X } from "lucide-react";
import type { BrowserCommand, BrowserState } from "@ohmycode/browser-use/types";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import { useBrowserViewport } from "./useBrowserViewport";
import { useBrowserResize } from "./useBrowserResize";
import { browserAddress } from "./browser-address";
import { BrowserDownloads } from "./BrowserDownloads";
import styles from "./BrowserPanel.module.css";

export function BrowserPanel({ conversationId, state, active, onClose, standalone = false }: { conversationId: string; state: BrowserState; active: boolean; onClose(): void; standalone?: boolean }) {
  const { t } = useTranslation();
  const viewport = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const resize = useBrowserResize(panel, active && !standalone);
  const [failure, setFailure] = useState<"navigation" | "window" | null>(null);
  const [moving, setMoving] = useState(false);
  const selected = state.tabs.find((tab) => tab.id === state.selectedId);
  useBrowserViewport(conversationId, viewport, active);

  async function command(value: BrowserCommand) {
    setFailure(null);
    try { await window.ohmycode.browser.command(conversationId, value); }
    catch { setFailure("navigation"); }
  }

  async function move() {
    setMoving(true);
    setFailure(null);
    try { await window.ohmycode.browser.setDetached(conversationId, !standalone); }
    catch { setFailure("window"); }
    finally { setMoving(false); }
  }

  return <aside ref={panel} className={`${styles.panel} ${standalone ? styles.standalone : ""}`} aria-label={t("browser.title")} style={{ "--browser-panel-width": resize.width ? `${resize.width}px` : undefined } as CSSProperties}>
    {!standalone && <div className={styles.resizeHandle} role="separator" tabIndex={0} aria-label={t("browserResize")} aria-orientation="vertical" aria-valuenow={resize.width ? Math.round(resize.width) : undefined} onPointerDown={resize.start} onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      resize.nudge(event.key === "ArrowLeft" ? 1 : -1);
    }} />}
    <header className={styles.header}>
      <div className={styles.heading}><Globe /><span>{t("browser.title")}</span></div>
      <div className={styles.actions}>
        <Tooltip content={t(standalone ? "browser.dock" : "browser.detach")}><IconButton disabled={moving} aria-label={t(standalone ? "browser.dock" : "browser.detach")} onClick={() => void move()}>{standalone ? <PanelRightClose /> : <SquareArrowOutUpRight />}</IconButton></Tooltip>
        {!standalone && <Tooltip content={t("browser.close")}><IconButton aria-label={t("browser.close")} onClick={onClose}><X /></IconButton></Tooltip>}
      </div>
    </header>
    <div className={styles.tabs} inert={state.operating}>
      {state.tabs.map((tab) => <div key={tab.id} className={`${styles.tab} ${tab.id === state.selectedId ? styles.selected : ""}`}>
        <button className={styles.tabTitle} title={tab.title || tab.url} onClick={() => void command({ action: "select", tabId: tab.id })}>{tab.title || t("browser.newTab")}</button>
        <Tooltip className={styles.tabClose} content={t("browser.closeTab")}><IconButton aria-label={t("browser.closeTab")} onClick={() => void command({ action: "close", tabId: tab.id })}><X /></IconButton></Tooltip>
      </div>)}
      <Tooltip content={t("browser.newTab")}><IconButton aria-label={t("browser.newTab")} onClick={() => void command({ action: "new" })}><Plus /></IconButton></Tooltip>
    </div>
    <div className={styles.toolbar} inert={state.operating}>
      <Tooltip content={t("browser.back")}><IconButton disabled={!selected?.canGoBack} aria-label={t("browser.back")} onClick={() => void command({ action: "back" })}><ArrowLeft /></IconButton></Tooltip>
      <Tooltip content={t("browser.forward")}><IconButton disabled={!selected?.canGoForward} aria-label={t("browser.forward")} onClick={() => void command({ action: "forward" })}><ArrowRight /></IconButton></Tooltip>
      <Tooltip content={t("browser.reload")}><IconButton disabled={!selected} aria-label={t("browser.reload")} onClick={() => void command({ action: "reload" })}>{selected?.loading ? <LoaderCircle className={styles.spin} /> : <RotateCw />}</IconButton></Tooltip>
      <form className={styles.address} onSubmit={(event) => {
        event.preventDefault();
        const url = browserAddress(String(new FormData(event.currentTarget).get("url") ?? ""));
        if (!url) return;
        void command(selected ? { action: "navigate", url } : { action: "new", url });
      }}><input key={`${selected?.id}:${selected?.url}`} name="url" defaultValue={selected?.url === "about:blank" ? "" : selected?.url} aria-label={t("browser.address")} placeholder={t("browser.address")} spellCheck={false} /></form>
    </div>
    {(failure || selected?.error) && <p className={styles.error} role="status">{t(failure === "window" ? "browser.windowFailed" : "browser.failed")}</p>}
    <BrowserDownloads downloads={state.downloads ?? []} onShow={(downloadId) => void command({ action: "show-download", downloadId })} onDismiss={(downloadId) => void command({ action: "dismiss-download", downloadId })} />
    <div ref={viewport} className={styles.viewport}>
      {!selected && <div className={styles.empty}><Globe /><span>{t("browser.empty")}</span></div>}
    </div>
  </aside>;
}
