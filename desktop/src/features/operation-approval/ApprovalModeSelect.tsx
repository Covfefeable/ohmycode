import { Check, ChevronDown, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import type { ApprovalMode } from "../../../contracts/domain";
import { Tooltip } from "../../shared/ui/tooltip";
import type { useOperationApproval } from "./useOperationApproval";
import styles from "./ApprovalModeSelect.module.css";

const modes: ApprovalMode[] = ["ask", "auto", "allow"];
const icons = { ask: ShieldCheck, auto: Sparkles, allow: ShieldAlert };

export function ApprovalModeSelect({ approval }: { approval: ReturnType<typeof useOperationApproval> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0, width: 340 });
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const Icon = icons[approval.mode];

  function show() {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 24);
    setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), bottom: window.innerHeight - rect.top + 8, width });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus();
    const pointer = (event: PointerEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    };
    const dismiss = () => setOpen(false);
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !menu.current?.contains(event.target)) dismiss(); };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", escape, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", scroll, true);
    return () => {
      document.removeEventListener("pointerdown", pointer);
      document.removeEventListener("keydown", escape, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", scroll, true);
    };
  }, [open]);

  return <>
    <Tooltip className={styles.root} content={t(`agent.approvalMode_${approval.mode}`)}>
      <button ref={trigger} type="button" aria-label={t("agent.approvalMode")} aria-haspopup="menu" aria-expanded={open} className={`${styles.trigger} ${approval.mode === "allow" ? styles.warning : ""}`} onClick={() => open ? setOpen(false) : show()} onKeyDown={(event) => {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); show(); }
      }}><Icon /><span>{t(`agent.approvalMode_${approval.mode}`)}</span><ChevronDown className={open ? styles.expanded : styles.chevron} /></button>
    </Tooltip>
    {open && createPortal(<div ref={menu} role="menu" aria-label={t("agent.approvalMode")} className={styles.menu} style={position} onKeyDown={(event) => {
      const buttons = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])];
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Tab") { setOpen(false); return; }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    }}>
      <div className={styles.caption}>{t("agent.approvalMode")}</div>
      {modes.map((mode) => {
        const ModeIcon = icons[mode];
        return <button key={mode} type="button" role="menuitemradio" aria-checked={approval.mode === mode} className={`${styles.option} ${mode === "allow" ? styles.warning : ""}`} onClick={() => { void approval.select(mode); setOpen(false); trigger.current?.focus(); }}>
          <span className={styles.icon}><ModeIcon /></span>
          <span className={styles.copy}><span className={styles.label}>{t(`agent.approvalMode_${mode}`)}</span><span className={styles.description}>{t(`agent.approvalDescription_${mode}`)}</span></span>
          {approval.mode === mode && <Check className={styles.check} />}
        </button>;
      })}
    </div>, document.body)}
  </>;
}
