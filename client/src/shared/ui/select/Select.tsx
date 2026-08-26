import { Check, ChevronDown } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "../tooltip";
import styles from "./Select.module.css";

export type SelectOption = { value: string; label: string };

type SelectProps = {
  value: string;
  options: SelectOption[];
  ariaLabel: string;
  disabled?: boolean;
  compact?: boolean;
  emptyLabel?: string;
  onChange(value: string): void;
};

export function Select({ value, options, ariaLabel, disabled = false, compact = false, emptyLabel = "", onChange }: SelectProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 220 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value);
  const label = selected?.label || emptyLabel;

  useLayoutEffect(() => {
    if (!open) return;
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(320, Math.max(compact ? 240 : rect.width, 180));
    const menuHeight = Math.min(320, options.length * 36 + 16);
    const opensBelow = rect.bottom + 8 + menuHeight <= window.innerHeight - 12;
    setPosition({
      left: Math.max(12, Math.min(compact ? rect.right - width : rect.left, window.innerWidth - width - 12)),
      top: opensBelow ? rect.bottom + 8 : Math.max(12, rect.top - menuHeight - 8),
      width,
    });
  }, [compact, open, options.length]);

  useEffect(() => {
    if (!open) return;
    const closeOnPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !(target as Element).closest?.("[data-select-menu]")) setOpen(false);
    };
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", closeOnPointer);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointer);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  return <>
    <Tooltip content={label || ariaLabel} className={compact ? styles.compactRoot : styles.fieldRoot}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.trigger} ${compact ? styles.compact : styles.field}`}
        disabled={disabled || options.length === 0}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{label}</span><ChevronDown className={open ? styles.open : ""} />
      </button>
    </Tooltip>
    {open && createPortal(<div data-select-menu role="listbox" aria-label={ariaLabel} className={styles.menu} style={position}>
      {options.map((option) => {
        const active = option.value === value;
        return <Tooltip key={option.value} content={option.label} className={styles.optionRoot}>
          <button type="button" role="option" aria-selected={active} className={active ? styles.selected : ""} onClick={() => { onChange(option.value); setOpen(false); }}>
            <span>{option.label}</span>{active && <Check />}
          </button>
        </Tooltip>;
      })}
    </div>, document.body)}
  </>;
}
