import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import styles from "./MessageList.module.css";

type ListContext = { clearance: number; loading: boolean; failed: boolean; retry(): void };
function HistoryStatus({ context }: { context?: ListContext }) {
  const { t } = useTranslation();
  return <div className={styles.history}>
    {context?.loading && <span role="status">{t("agent.loadingHistory")}</span>}
    {context?.failed && <button onClick={context.retry}>{t("agent.historyFailed")} · {t("common.retry")}</button>}
  </div>;
}
function ComposerClearance({ context }: { context?: ListContext }) {
  return <div style={{ height: context?.clearance ?? 0 }} />;
}
const components = { Header: HistoryStatus, Footer: ComposerClearance };
// Virtuoso requires positive indices when prepending; this is an index origin, not a message limit.
const HISTORY_INDEX_ORIGIN = 1_000_000_000;

type Props = {
  messages: LocalMessage[];
  prependedCount: number;
  clearance: number;
  loading: boolean;
  failed: boolean;
  loadOlder(): Promise<void>;
  active: boolean;
  listRef: RefObject<VirtuosoHandle | null>;
  followRef: RefObject<boolean>;
  renderMessage(message: LocalMessage): ReactNode;
};

export function MessageList({ messages, prependedCount, clearance, loading, failed, loadOlder, active, listRef, followRef, renderMessage }: Props) {
  const frame = useRef<number | null>(null);
  const lastScrollTop = useRef(0);
  const stickToBottom = useCallback(() => {
    if (!active || !followRef.current || frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      if (followRef.current) listRef.current?.scrollToIndex({ index: "LAST", align: "end", offset: clearance });
    });
  }, [active, clearance, followRef, listRef]);
  useEffect(() => {
    stickToBottom();
    return () => { if (frame.current !== null) cancelAnimationFrame(frame.current); frame.current = null; };
  }, [messages, clearance, stickToBottom]);
  return <Virtuoso
    ref={listRef}
    className={styles.viewport}
    data={messages}
    firstItemIndex={HISTORY_INDEX_ORIGIN - prependedCount}
    initialTopMostItemIndex={{ index: "LAST", align: "end", offset: clearance }}
    computeItemKey={(_index, message) => message.id}
    increaseViewportBy={{ top: 500, bottom: 300 }}
    atBottomThreshold={36}
    onWheel={(event) => { if (event.deltaY < 0) followRef.current = false; }}
    onTouchMove={() => { followRef.current = false; }}
    onPointerDown={(event) => { if (event.target === event.currentTarget) followRef.current = false; }}
    onKeyDown={(event) => { if (["ArrowUp", "PageUp", "Home"].includes(event.key)) followRef.current = false; }}
    tabIndex={0}
    onScroll={(event) => {
      const scroller = event.currentTarget;
      const distance = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
      if (scroller.scrollTop > lastScrollTop.current && distance <= 36) followRef.current = true;
      lastScrollTop.current = scroller.scrollTop;
    }}
    totalListHeightChanged={stickToBottom}
    startReached={() => { if (!loading && !failed) void loadOlder(); }}
    components={components}
    context={{ clearance, loading, failed, retry: () => void loadOlder() }}
    itemContent={(_index, message) => <div className={styles.row}>{renderMessage(message)}</div>}
    style={{ height: "100%" }}
  />;
}
