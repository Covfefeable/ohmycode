import { useCallback, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Circle, LoaderCircle, PanelRightClose, Play, Power, RefreshCw, Smartphone, Square, SquareArrowOutUpRight, X } from "lucide-react";
import type { AndroidAction, AndroidState } from "@ohmycode/android-use/types";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./AndroidPanel.module.css";
import { useAndroidVideo } from "./useAndroidVideo";
import { useAndroidPresentation } from "./useAndroidPresentation";
import { useSidePanelResize } from "../../shared/hooks/useSidePanelResize";
import { useAndroidPointer } from "./useAndroidPointer";

export function AndroidPanel({ state, active, onClose, standalone = false, conversationId }: { state: AndroidState; active: boolean; onClose(): void; standalone?: boolean; conversationId?: string }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const detached = useAndroidPresentation();
  const visible = active && (standalone || !detached);
  const resize = useSidePanelResize(panel, visible && !standalone, "ohmycode.androidPanelWidth");
  const [failure, setFailure] = useState<"occupied" | "operation" | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const video = useAndroidVideo(canvas, visible && state.phase === "running", attempt);
  const inputFailed = useCallback((error: unknown) => {
    setFailure(error instanceof Error && error.message.includes("android_in_use_by_another_conversation") ? "occupied" : "operation");
  }, []);
  const pointer = useAndroidPointer(conversationId ?? state.ownerConversationId ?? "", video.size, visible && state.phase === "running", inputFailed);
  async function act(action: AndroidAction) {
    try { await window.ohmycode.android.act(conversationId ?? state.ownerConversationId ?? "", action); setFailure(null); }
    catch (error) { inputFailed(error); }
  }
  async function start() {
    setBusy(true);
    try { await window.ohmycode.android.start(conversationId!); setFailure(null); }
    catch (error) { inputFailed(error); }
    finally { setBusy(false); }
  }
  async function powerOff() {
    setBusy(true);
    try { await window.ohmycode.android.stop(); setFailure(null); }
    catch (error) { inputFailed(error); }
    finally { setBusy(false); }
  }
  const running = state.phase === "running";
  if (!standalone && detached) return null;
  return <aside ref={panel} className={`${styles.panel} ${standalone ? styles.standalone : ""}`} aria-label={t("android.title")} style={{ "--browser-panel-width": resize.width ? `${resize.width}px` : undefined } as CSSProperties}>
    {!standalone && <div className={styles.resizeHandle} role="separator" tabIndex={0} aria-label={t("android.resize")} aria-orientation="vertical" aria-valuenow={resize.width ? Math.round(resize.width) : undefined} onPointerDown={resize.start} onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); resize.nudge(event.key === "ArrowLeft" ? 1 : -1);
    }} />}
    <header className={styles.header}><span><Smartphone />{t("android.title")}</span><div className={styles.actions}>
      <Tooltip content={t(standalone ? "browser.dock" : "browser.detach")}><IconButton aria-label={t(standalone ? "browser.dock" : "browser.detach")} onClick={() => { void window.ohmycode.android.setDetached(!standalone).catch(inputFailed); }}>{standalone ? <PanelRightClose /> : <SquareArrowOutUpRight />}</IconButton></Tooltip>
      {!standalone && <Tooltip content={t("android.hide")}><IconButton aria-label={t("android.hide")} onClick={onClose}><X /></IconButton></Tooltip>}
    </div></header>
    <div className={styles.screen}>
      {running && <canvas ref={canvas} aria-label={t("android.screen")} tabIndex={0} style={{ visibility: video.size ? "visible" : "hidden", aspectRatio: video.size ? `${video.size.width} / ${video.size.height}` : undefined }}
        {...pointer}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Backspace") { event.preventDefault(); void act({ action: "key", key: event.key === "Enter" ? "enter" : "delete" }); }
          else if (event.key.length === 1 && /^[\x20-\x7e]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) { event.preventDefault(); void act({ action: "text", text: event.key }); }
        }} />}
      {(!running || !video.size) && <div className={styles.empty}>{(state.phase === "starting" || state.phase === "stopping" || running) && <><LoaderCircle className={styles.spin} /><span>{t(running ? "android.connecting" : `android.phases.${state.phase}`)}</span></>}{conversationId && !running && state.phase !== "starting" && state.phase !== "stopping" && <button disabled={busy} onClick={() => void start()}><Play />{t("android.start")}</button>}</div>}
    </div>
    {(failure || video.failed || state.error) && <div role="alert" className={styles.error}>{t(failure === "occupied" ? "android.occupied" : video.failed ? "android.videoFailed" : "android.operationFailed")}{failure !== "occupied" && <IconButton aria-label={t("common.retry")} onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}><RefreshCw /></IconButton>}</div>}
    <footer className={styles.navigation}>{([{ key: "back", Icon: ArrowLeft }, { key: "home", Icon: Circle }, { key: "recent", Icon: Square }] as const).map(({ key, Icon }) => <Tooltip key={key} content={t(`android.keys.${key}`)}><IconButton disabled={!running} aria-label={t(`android.keys.${key}`)} onClick={() => void act({ action: "key", key })}><Icon /></IconButton></Tooltip>)}<Tooltip content={t("android.powerOff")}><IconButton className={styles.power} disabled={(busy && state.phase !== "starting") || (state.phase !== "running" && state.phase !== "starting")} aria-label={t("android.powerOff")} onClick={() => void powerOff()}><Power /></IconButton></Tooltip></footer>
  </aside>;
}
