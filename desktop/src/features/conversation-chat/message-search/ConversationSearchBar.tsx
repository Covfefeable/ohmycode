import type { RefObject } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, LoaderCircle, RotateCw, Search, X } from "lucide-react";
import { IconButton } from "../../../shared/ui/icon-button";
import { Tooltip } from "../../../shared/ui/tooltip";
import styles from "./ConversationSearchBar.module.css";

type Props = {
  query: string; result: MessageSearchResult | null; loading: boolean; failed: boolean;
  inputRef: RefObject<HTMLInputElement | null>;
  onChange(value: string): void; onMove(direction: "next" | "previous"): void; onClose(): void; onRetry(): void;
};

export function ConversationSearchBar({ query, result, loading, failed, inputRef, onChange, onMove, onClose, onRetry }: Props) {
  const { t } = useTranslation();
  return <div className={styles.bar} role="search" aria-label={t("agent.searchConversation")}>
    <Search className={styles.searchIcon} />
    <input ref={inputRef} autoFocus value={query} aria-label={t("agent.searchConversation")} placeholder={t("agent.searchConversation")} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Enter") { event.preventDefault(); if (!loading && result?.total) onMove(event.shiftKey ? "previous" : "next"); }
    }} />
    <span className={styles.count} role="status" aria-live="polite">{loading ? <LoaderCircle className={styles.spinner} /> : failed ? t("agent.searchFailed") : result ? `${result.position} / ${result.total}` : ""}</span>
    {failed && <Tooltip content={t("common.retry")}><IconButton aria-label={t("common.retry")} onClick={onRetry}><RotateCw /></IconButton></Tooltip>}
    <Tooltip content={t("agent.previousMatch")}><IconButton aria-label={t("agent.previousMatch")} disabled={loading || !result?.total} onClick={() => onMove("previous")}><ArrowUp /></IconButton></Tooltip>
    <Tooltip content={t("agent.nextMatch")}><IconButton aria-label={t("agent.nextMatch")} disabled={loading || !result?.total} onClick={() => onMove("next")}><ArrowDown /></IconButton></Tooltip>
    <Tooltip content={t("common.close")}><IconButton aria-label={t("common.close")} onClick={onClose}><X /></IconButton></Tooltip>
  </div>;
}
