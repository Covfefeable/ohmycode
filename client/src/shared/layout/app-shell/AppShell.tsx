import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PropsWithChildren, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./AppShell.module.css";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 420;
const SIDEBAR_STORAGE_KEY = "ohmycode.app-shell.sidebar-width";

function initialSidebarWidth(): number {
  const saved = Number(window.localStorage.getItem(SIDEBAR_STORAGE_KEY));
  return Number.isFinite(saved)
    ? Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, saved))
    : 300;
}

type AppShellProps = PropsWithChildren<{
  navigation: ReactNode;
  sidebar: ReactNode;
}>;

export function AppShell({ navigation, sidebar, children }: AppShellProps) {
  const { t } = useTranslation();
  const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
  const widthRef = useRef(sidebarWidth);
  useEffect(() => { widthRef.current = sidebarWidth; }, [sidebarWidth]);

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const shell = handle.closest("main");
    const startX = event.clientX;
    const startWidth = widthRef.current;
    handle.setPointerCapture(event.pointerId);
    document.documentElement.classList.add(styles.resizing);
    const move = (moveEvent: PointerEvent) => {
      widthRef.current = Math.min(
        SIDEBAR_MAX_WIDTH,
        Math.max(SIDEBAR_MIN_WIDTH, startWidth + moveEvent.clientX - startX),
      );
      shell?.style.setProperty("--app-sidebar-width", `${widthRef.current}px`);
    };
    const stop = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", stop);
      handle.removeEventListener("pointercancel", stop);
      document.documentElement.classList.remove(styles.resizing);
      setSidebarWidth(widthRef.current);
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(Math.round(widthRef.current)));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function resizeWithKeyboard(direction: -1 | 1) {
    const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth + direction * 12));
    widthRef.current = next;
    setSidebarWidth(next);
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
  }

  return (
    <main className={styles.shell} style={{ "--app-sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      {navigation}
      <div className={styles.sidebarFrame}>
        {sidebar}
        <div
          aria-label={t("workspace.resizeSidebar")}
          aria-orientation="vertical"
          aria-valuemin={SIDEBAR_MIN_WIDTH}
          aria-valuemax={SIDEBAR_MAX_WIDTH}
          aria-valuenow={Math.round(sidebarWidth)}
          className={styles.resizeHandle}
          role="separator"
          tabIndex={0}
          onPointerDown={startResize}
          onKeyDown={(event) => {
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            resizeWithKeyboard(event.key === "ArrowRight" ? 1 : -1);
          }}
        />
      </div>
      {children}
    </main>
  );
}
