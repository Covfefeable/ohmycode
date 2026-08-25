import { type PropsWithChildren, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

type TooltipProps = PropsWithChildren<{ content: string; className?: string }>;
type Anchor = { centerX: number; top: number; bottom: number };

export function Tooltip({ children, content, className = "" }: TooltipProps) {
  const id = useId();
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function show(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setAnchor({ centerX: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom });
  }

  useLayoutEffect(() => {
    const tooltip = tooltipRef.current;
    if (!anchor || !tooltip) return;
    const margin = 12;
    const gap = 8;
    const rect = tooltip.getBoundingClientRect();
    const halfWidth = rect.width / 2;
    const left = Math.min(
      window.innerWidth - margin - halfWidth,
      Math.max(margin + halfWidth, anchor.centerX),
    );
    const below = anchor.bottom + gap;
    const top = below + rect.height <= window.innerHeight - margin
      ? below
      : Math.max(margin, anchor.top - gap - rect.height);
    setPosition({ left, top });
  }, [anchor, content]);

  useEffect(() => {
    if (!anchor) return;
    const close = () => { setAnchor(null); setPosition(null); };
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [anchor]);

  const hide = () => { setAnchor(null); setPosition(null); };

  return <span
    className={`${styles.trigger} ${className}`}
    aria-describedby={anchor ? id : undefined}
    onMouseEnter={(event) => show(event.currentTarget)}
    onMouseLeave={hide}
    onMouseDown={hide}
    onFocus={(event) => show(event.currentTarget)}
    onBlur={hide}
  >
    {children}
    {anchor && createPortal(<span ref={tooltipRef} id={id} role="tooltip" className={styles.tooltip} data-positioned={Boolean(position)} style={position ?? { left: anchor.centerX, top: anchor.bottom + 8 }}>{content}</span>, document.body)}
  </span>;
}
