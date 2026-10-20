import { useRef } from "react";
import type { CSSProperties, PropsWithChildren, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import styles from "./AppShell.module.css";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH, setSidebarWidth, useSidebarState } from "./sidebar-state";

type AppShellProps = PropsWithChildren<{
  navigation: ReactNode;
  sidebar: ReactNode;
}>;

export function AppShell({ navigation, sidebar, children }: AppShellProps) {
  const { t } = useTranslation();
  const { width: sidebarWidth, collapsed } = useSidebarState();
  const widthRef = useRef(sidebarWidth);

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    const shell = handle.closest("main");
    const startX = event.clientX;
    const startWidth = sidebarWidth;
    widthRef.current = sidebarWidth;
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
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", stop);
    handle.addEventListener("pointercancel", stop);
  }

  function resizeWithKeyboard(direction: -1 | 1) {
    const next = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, sidebarWidth + direction * 12));
    widthRef.current = next;
    setSidebarWidth(next);
  }

  return (
    <main className={styles.shell} style={{ "--app-sidebar-width": `${collapsed ? 0 : sidebarWidth}px` } as CSSProperties}>
      {navigation}
      <div id="app-sidebar" className={`${styles.sidebarFrame} ${collapsed ? styles.collapsed : ""}`} inert={collapsed} aria-hidden={collapsed}>
        {sidebar}
        {!collapsed && <div
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
        />}
      </div>
      {children}
    </main>
  );
}
