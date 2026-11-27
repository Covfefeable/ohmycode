import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../tooltip";
import styles from "./ModelPicker.module.css";

type Props = {
  models: ModelConfiguration[];
  modelId: string;
  effort?: string;
  disabled?: boolean;
  variant?: "compact" | "field";
  defaultLabel?: string;
  ariaLabel?: string;
  onModelChange(id: string): void;
  onEffortChange?(key: string): void;
};

export function ModelPicker({ models, modelId, effort = "", disabled, variant = "compact", defaultLabel, ariaLabel, onModelChange, onEffortChange }: Props) {
  const { t } = useTranslation();
  const model = models.find((item) => item.id === modelId) ?? (!modelId && defaultLabel ? models[0] : undefined);
  const levels = [{ name: t("reasoning.default"), key: "" }, ...(model?.reasoningLevels ?? [])];
  const selected = Math.max(0, levels.findIndex((level) => level.key === effort));
  const [view, setView] = useState<"effort" | "models" | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ left: 0, bottom: 0, width: 300 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const hasEffort = Boolean(model?.reasoningEnabled && onEffortChange && levels.length > 1);
  const label = (!modelId && defaultLabel) || model?.name || model?.model || t("agent.noModel");
  if (view && (disabled || (!models.length && !defaultLabel))) setView(null);

  useLayoutEffect(() => {
    if (!view) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(variant === "field" ? Math.max(300, rect.width) : 300, window.innerWidth - 24);
    const height = Math.min(420, panel.current?.offsetHeight ?? 200);
    const below = variant === "field" && rect.bottom + height + 8 <= window.innerHeight - 12;
    setPosition({ width, left: Math.max(12, Math.min(variant === "field" ? rect.left : rect.right - width, window.innerWidth - width - 12)), ...(below ? { top: rect.bottom + 8 } : { bottom: window.innerHeight - rect.top + 8 }), maxHeight: Math.max(80, below ? window.innerHeight - rect.bottom - 20 : rect.top - 20) });
    panel.current?.querySelector<HTMLElement>("[aria-selected='true'], input, button")?.focus();
  }, [view, variant]);

  useEffect(() => {
    if (!view) return;
    const dismiss = () => setView(null);
    const outside = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !panel.current?.contains(event.target as Node)) dismiss();
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); dismiss(); trigger.current?.focus(); }
    };
    const scroll = (event: Event) => { if (!panel.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", keydown);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", keydown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [view]);

  return <>
    <Tooltip className={variant === "field" ? styles.fieldRoot : styles.root} content={hasEffort ? `${label} · ${levels[selected].name}` : label}>
      <button ref={trigger} type="button" className={`${styles.trigger} ${variant === "field" ? styles.field : ""}`} disabled={disabled || (!models.length && !defaultLabel)} aria-label={ariaLabel ?? t("agent.model")} aria-haspopup="dialog" aria-expanded={Boolean(view)} onClick={() => setView((current) => current ? null : hasEffort ? "effort" : "models")}>
        <span>{label}</span>{hasEffort && <span className={styles.effortLabel}>{levels[selected].name}</span>}<ChevronDown />
      </button>
    </Tooltip>
    {view && !disabled && createPortal(<div ref={panel} role="dialog" aria-label={t(view === "models" ? "agent.model" : "reasoning.title")} className={styles.panel} style={position}>
      {view === "models" ? <>
        <div className={styles.heading}>{t("reasoning.selectModel")}</div>
        <div className={styles.models} role="listbox" aria-label={t("agent.model")} onKeyDown={(event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const options = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
          const index = options.indexOf(document.activeElement as HTMLButtonElement);
          options[(index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length]?.focus();
        }}>
          {defaultLabel && <button type="button" role="option" aria-selected={!modelId} className={!modelId ? styles.active : undefined} onClick={() => { onModelChange(""); setView(null); trigger.current?.focus(); }}><span>{defaultLabel}</span>{!modelId && <Check />}</button>}
          {models.map((item) => <button type="button" role="option" aria-selected={item.id === modelId} key={item.id} className={item.id === modelId ? styles.active : undefined} onClick={() => { onModelChange(item.id); setView(null); trigger.current?.focus(); }}><span>{item.name || item.model}</span>{item.id === modelId && <Check />}</button>)}
        </div>
      </> : <>
        <button type="button" className={styles.modelLink} onClick={() => setView("models")}><span>{label}</span><ChevronRight /></button>
        <div className={styles.effortSection}>
          <div className={styles.effortTitle}>{t("reasoning.title")}</div>
          <div className={styles.levels} role="group" aria-label={t("reasoning.title")}>
            {levels.map((level, index) => <button type="button" key={level.key} aria-pressed={index === selected} onClick={() => onEffortChange?.(level.key)}>{level.name}</button>)}
          </div>
        </div>
      </>}
    </div>, document.body)}
  </>;
}
