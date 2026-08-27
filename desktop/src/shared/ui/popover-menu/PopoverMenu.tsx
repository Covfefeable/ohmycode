import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./PopoverMenu.module.css";

type PopoverMenuProps = {
  trigger: ReactNode;
  children: ReactNode;
  mode?: "click" | "hover";
};

export function PopoverMenu({ trigger, children, mode = "click" }: PopoverMenuProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CSSProperties>({ top: 0, left: 0 });
  const rootRef = useRef<HTMLSpanElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  function place() {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 220;
    const opensRight = rect.right + width + 8 <= window.innerWidth - 12;
    const top = Math.max(12, Math.min(rect.top, window.innerHeight - 112));
    setPosition(opensRight
      ? { top, left: rect.right + 8 }
      : { top, right: window.innerWidth - rect.left + 8 });
  }

  function show() { window.clearTimeout(closeTimer.current); place(); setOpen(true); }
  function hideSoon() { closeTimer.current = window.setTimeout(() => setOpen(false), 120); }

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node) && !(event.target as Element).closest?.(`[data-popover-menu]`)) setOpen(false);
    };
    const dismiss = () => setOpen(false);
    document.addEventListener("pointerdown", close);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  return <span
    ref={rootRef}
    className={styles.root}
    onMouseEnter={mode === "hover" ? show : undefined}
    onMouseLeave={mode === "hover" ? hideSoon : undefined}
    onClick={mode === "click" ? () => { if (!open) place(); setOpen((value) => !value); } : undefined}
  >
    {trigger}
    {open && createPortal(<div
      data-popover-menu
      className={styles.menu}
      style={position}
      onMouseEnter={mode === "hover" ? show : undefined}
      onMouseLeave={mode === "hover" ? hideSoon : undefined}
      onClick={(event) => { event.stopPropagation(); setOpen(false); }}
    >{children}</div>, document.body)}
  </span>;
}
