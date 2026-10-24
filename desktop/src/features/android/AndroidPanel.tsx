import { useCallback, useMemo, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Circle, CircleAlert, LockKeyhole, LoaderCircle, PanelRightClose, Play, Power, Unplug, RefreshCw, Smartphone, Square, SquareArrowOutUpRight, X } from "lucide-react";
import type { AndroidAction, AndroidState } from "@ohmycode/android-use/types";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./AndroidPanel.module.css";
import { useAndroidVideo } from "./useAndroidVideo";
import { useAndroidPresentation } from "./useAndroidPresentation";
import { useSidePanelResize } from "../../shared/hooks/useSidePanelResize";
import { useAndroidPointer } from "./useAndroidPointer";
import { androidErrorKey } from "./android-error";

export function AndroidPanel({ state, active, onClose, standalone = false, conversationId }: { state: AndroidState; active: boolean; onClose(): void; standalone?: boolean; conversationId: string }) {
  const { t } = useTranslation();
  const canvas = useRef<HTMLCanvasElement>(null);
  const panel = useRef<HTMLElement>(null);
  const detached = useAndroidPresentation();
  const visible = active && (standalone || !detached);
  const resize = useSidePanelResize(panel, visible && !standalone, "ohmycode.androidPanelWidth");
  const context = useMemo(() => ({ conversationId, owner: state.ownerConversationId, phase: state.phase }), [conversationId, state.ownerConversationId, state.phase]);
  const [failure, setFailure] = useState<{ context: object; key: string } | null>(null);
  const failureKey = failure?.context === context ? failure.key : null;
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const running = state.phase === "running";
  const occupied = Boolean(state.ownerConversationId && state.ownerConversationId !== conversationId);
  const video = useAndroidVideo(canvas, conversationId, visible && running && !occupied && !failureKey && !state.error, attempt);
  const errorKey = occupied ? "android.errors.android_in_use_by_another_conversation" : failureKey ?? (state.error ? `android.errors.${state.error}` : video.error);
  const inputFailed = useCallback((error: unknown) => {
    setFailure({ context, key: androidErrorKey(error) });
  }, [context]);
  const pointer = useAndroidPointer(conversationId, video.size, visible && running && !errorKey, inputFailed);
  async function act(action: AndroidAction) {
    try { await window.ohmycode.android.act(conversationId, action); setFailure(null); }
    catch (error) { inputFailed(error); }
  }
  async function start() {
    setBusy(true);
    try { await window.ohmycode.android.start(conversationId); setFailure(null); }
    catch (error) { inputFailed(error); }
    finally { setBusy(false); }
  }
  async function powerOff() {
    setBusy(true);
    try { await window.ohmycode.android.stop(conversationId); setFailure(null); }
    catch (error) { inputFailed(error); }
    finally { setBusy(false); }
  }
  const external = state.target.kind === "external";
  const title = state.target.kind === "external" ? state.target.name : t(state.target.kind === "managed" ? "android.devices.builtIn" : "android.title");
  if (!standalone && detached && !occupied) return null;
  return <aside ref={panel} className={`${styles.panel} ${standalone ? styles.standalone : ""}`} aria-label={t("android.title")} style={{ "--browser-panel-width": resize.width ? `${resize.width}px` : undefined } as CSSProperties}>
    {!standalone && <div className={styles.resizeHandle} role="separator" tabIndex={0} aria-label={t("android.resize")} aria-orientation="vertical" aria-valuenow={resize.width ? Math.round(resize.width) : undefined} onPointerDown={resize.start} onKeyDown={(event) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault(); resize.nudge(event.key === "ArrowLeft" ? 1 : -1);
    }} />}
    <header className={styles.header}><Tooltip content={title}><span className={styles.deviceName}><Smartphone /><span>{title}</span></span></Tooltip><div className={styles.actions}>
      <Tooltip content={t(standalone ? "browser.dock" : "browser.detach")}><IconButton disabled={occupied && !standalone} aria-label={t(standalone ? "browser.dock" : "browser.detach")} onClick={() => { void window.ohmycode.android.setDetached(!standalone, conversationId).catch(inputFailed); }}>{standalone ? <PanelRightClose /> : <SquareArrowOutUpRight />}</IconButton></Tooltip>
      {!standalone && <Tooltip content={t("android.hide")}><IconButton aria-label={t("android.hide")} onClick={onClose}><X /></IconButton></Tooltip>}
    </div></header>
    <div className={styles.screen}>
      {!errorKey && running && <canvas ref={canvas} aria-label={t("android.screen")} tabIndex={0} style={{ visibility: video.size ? "visible" : "hidden", aspectRatio: video.size ? `${video.size.width} / ${video.size.height}` : undefined }}
        {...pointer}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "Backspace") { event.preventDefault(); void act({ action: "key", key: event.key === "Enter" ? "enter" : "delete" }); }
          else if (event.key.length === 1 && /^[\x20-\x7e]$/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing) { event.preventDefault(); void window.ohmycode.android.type(conversationId, event.key).catch(inputFailed); }
        }} />}
      {errorKey ? <div role="alert" className={styles.errorState}>
        {occupied ? <LockKeyhole /> : <CircleAlert />}
        <p>{t(errorKey, { defaultValue: t("android.operationFailed") })}</p>
        {!occupied && <Tooltip content={t("common.retry")}><IconButton aria-label={t("common.retry")} onClick={() => { setFailure(null); setAttempt((value) => value + 1); }}><RefreshCw /></IconButton></Tooltip>}
      </div> : (!running || !video.size) && <div className={styles.empty}>{(state.phase === "starting" || state.phase === "stopping" || running) && <><LoaderCircle className={styles.spin} /><span>{t(running || external ? "android.connecting" : `android.phases.${state.phase}`)}</span></>}{conversationId && !running && state.phase !== "starting" && state.phase !== "stopping" && (state.installed ? <button disabled={busy} onClick={() => void start()}><Play />{t(external ? "android.devices.connect" : "android.start")}</button> : <span>{t("android.devices.chooseInSettings")}</span>)}</div>}
    </div>
    <footer className={styles.navigation}>{([{ key: "back", Icon: ArrowLeft }, { key: "home", Icon: Circle }, { key: "recent", Icon: Square }] as const).map(({ key, Icon }) => <Tooltip key={key} content={t(`android.keys.${key}`)}><IconButton disabled={!running || Boolean(errorKey)} aria-label={t(`android.keys.${key}`)} onClick={() => void act({ action: "key", key })}><Icon /></IconButton></Tooltip>)}<Tooltip content={t(external ? "android.devices.disconnect" : "android.powerOff")}><IconButton className={styles.power} disabled={occupied || (busy && state.phase !== "starting") || (state.phase !== "running" && state.phase !== "starting")} aria-label={t(external ? "android.devices.disconnect" : "android.powerOff")} onClick={() => void powerOff()}>{external ? <Unplug /> : <Power />}</IconButton></Tooltip></footer>
  </aside>;
}
