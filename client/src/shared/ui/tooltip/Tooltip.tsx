import { type PropsWithChildren, useId, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./Tooltip.module.css";

type TooltipProps = PropsWithChildren<{ content: string; className?: string }>;

export function Tooltip({ children, content, className = "" }: TooltipProps) {
  const id = useId();
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  function show(element: HTMLElement) {
    const rect = element.getBoundingClientRect();
    setPosition({ left: rect.left + rect.width / 2, top: rect.bottom + 8 });
  }

  return <span
    className={`${styles.trigger} ${className}`}
    aria-describedby={position ? id : undefined}
    onMouseEnter={(event) => show(event.currentTarget)}
    onMouseLeave={() => setPosition(null)}
    onMouseDown={() => setPosition(null)}
    onFocus={(event) => show(event.currentTarget)}
    onBlur={() => setPosition(null)}
  >
    {children}
    {position && createPortal(<span id={id} role="tooltip" className={styles.tooltip} style={position}>{content}</span>, document.body)}
  </span>;
}
