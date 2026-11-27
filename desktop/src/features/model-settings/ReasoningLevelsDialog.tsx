import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../../shared/ui/button";
import { IconButton } from "../../shared/ui/icon-button";
import { Tooltip } from "../../shared/ui/tooltip";
import { TextInput } from "../../shared/ui/form-control";
import styles from "./ReasoningLevelsDialog.module.css";

type Level = { name: string; key: string };

const presets = [
  { model: "OpenAI GPT / o", keys: ["low", "medium", "high"] },
  { model: "DeepSeek V4.1", keys: ["low", "high", "max"] },
  { model: "Qwen3.8", keys: ["none", "low", "medium", "xhigh"] },
  { model: "Qwen4-Max", keys: ["none", "low", "high", "xhigh"] },
  { model: "GLM-5.3", keys: ["low", "high", "max"] },
  { model: "Kimi K3 / K3.1 Pro", keys: ["low", "high", "max"] },
  { model: "MiniMax M3.1-Flash", keys: ["low", "medium", "high", "xhigh", "max"] },
  { model: "Grok 4.6 / 4.7", keys: ["low", "medium", "high", "xhigh"] },
];

export function ReasoningLevelsDialog({ levels, onSave, onClose }: {
  levels: Level[];
  onSave(levels: Level[]): void;
  onClose(): void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [presetsOpen, setPresetsOpen] = useState(false);
  const presetList = useRef<HTMLDivElement>(null);
  const presetsId = useId();
  const [rows, setRows] = useState(() => levels.map((level) => ({ ...level, id: crypto.randomUUID() })));
  const valid = rows.every((row) => row.name.trim() && row.key.trim()) && new Set(rows.map((row) => row.key.trim())).size === rows.length;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => previous?.focus();
  }, []);
  return createPortal(<dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <header><h2 id={titleId}>{t("reasoning.configure")}</h2><IconButton aria-label={t("common.close")} onClick={onClose}><X /></IconButton></header>
    <p>{t("reasoning.description")}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (valid) { onSave(rows.map(({ name, key }) => ({ name: name.trim(), key: key.trim() }))); onClose(); } }}>
      <div className={styles.columns}><span>{t("reasoning.name")}</span><span>{t("reasoning.key")}</span><span /></div>
      <div className={styles.rows}>
        <div className={styles.row}><span>{t("reasoning.default")}</span><span className={styles.muted}>{t("reasoning.omitted")}</span><span /></div>
        {rows.map((row) => <div className={styles.row} key={row.id}>
          <TextInput aria-label={t("reasoning.name")} placeholder={t("reasoning.namePlaceholder")} maxLength={100} required value={row.name} onChange={(event) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, name: event.target.value } : item))} />
          <TextInput aria-label={t("reasoning.key")} placeholder={t("reasoning.keyPlaceholder")} maxLength={100} required value={row.key} onChange={(event) => setRows((items) => items.map((item) => item.id === row.id ? { ...item, key: event.target.value } : item))} />
          <Tooltip content={t("common.delete")}><IconButton tone="danger" aria-label={t("common.delete")} onClick={() => setRows((items) => items.filter((item) => item.id !== row.id))}><Trash2 /></IconButton></Tooltip>
        </div>)}
      </div>
      <div className={styles.actions}>
        <Button type="button" disabled={rows.length >= 32} onClick={() => setRows((items) => [...items, { id: crypto.randomUUID(), name: "", key: "" }])}><Plus />{t("reasoning.add")}</Button>
        <Button type="button" className={styles.presetTrigger} popoverTarget={presetsId} aria-expanded={presetsOpen} aria-controls={presetsId}>{t("reasoning.usePresets")}<ChevronDown className={presetsOpen ? styles.open : undefined} /></Button>
      </div>
      <div ref={presetList} id={presetsId} popover="auto" className={styles.presetList} onToggle={(event) => setPresetsOpen(event.newState === "open")}>
        <small>{t("reasoning.presetHint")}</small>
        {presets.map((preset) => <button type="button" key={preset.model} onClick={() => { setRows(preset.keys.map((key) => ({ id: crypto.randomUUID(), name: t(`reasoning.levelNames.${key}`), key }))); presetList.current?.hidePopover(); }}><span>{preset.model}</span><small>{preset.keys.join(" / ")}</small></button>)}
      </div>
      <footer><Button type="button" onClick={onClose}>{t("common.cancel")}</Button><Button type="submit" variant="primary" disabled={!valid}>{t("reasoning.apply")}</Button></footer>
    </form>
  </dialog>, document.body);
}
