import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle } from "lucide-react";
import type { OperationFeedback } from "@ohmycode/tool-contracts";
import styles from "./OperationOverlay.module.css";

const FEEDBACK_HOLD_MS = 1200;

export function OperationOverlay({ feedback, native = false, onHidden }: { feedback?: OperationFeedback; native?: boolean; onHidden?(): void }) {
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const [dismissed, setDismissed] = useState<OperationFeedback>();
  const visible = Boolean(feedback && (feedback.active || feedback !== dismissed));
  useEffect(() => {
    if (feedback && !feedback.active) {
      const timer = setTimeout(() => setDismissed(feedback), FEEDBACK_HOLD_MS);
      return () => clearTimeout(timer);
    }
  }, [feedback]);
  useEffect(() => {
    if (visible || feedback?.active) return;
    const timer = setTimeout(() => onHidden?.(), 180);
    return () => clearTimeout(timer);
  }, [visible, feedback?.active, onHidden]);
  const [display, setDisplay] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setDisplay({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(root.current!);
    return () => observer.disconnect();
  }, []);
  const pointer = feedback?.pointer;
  const size = pointer?.size;
  const points = pointer?.points.map((point) => size ? { x: point.x * display.width / size.width, y: point.y * display.height / size.height } : point);
  const first = points?.[0];
  const last = points?.at(-1);
  return <div ref={root} className={`${styles.overlay} ${native ? styles.native : ""}`} data-active={visible} data-blocked={Boolean(feedback?.active)}>
    <div className={styles.gradient} />
    <svg className={styles.marks} aria-hidden="true">
      {pointer && first && last && <g key={pointer.id} className={styles.pointer} style={{ "--gesture-duration": `${Math.max(pointer.durationMs, FEEDBACK_HOLD_MS)}ms` } as CSSProperties}>
        {points!.length > 1 && <polyline points={points!.map((point) => `${point.x},${point.y}`).join(" ")} />}
        <circle cx={first.x} cy={first.y} r="5" className={styles.dot} />
        <circle cx={first.x} cy={first.y} r="22" className={styles.ring}>
          <animate attributeName="r" from="12" to="22" dur="300ms" fill="freeze" />
          {pointer.points.length > 1 && <>
            <animate attributeName="cx" from={first.x} to={last.x} dur={`${pointer.durationMs}ms`} fill="freeze" />
            <animate attributeName="cy" from={first.y} to={last.y} dur={`${pointer.durationMs}ms`} fill="freeze" />
          </>}
        </circle>
      </g>}
    </svg>
    {visible && <div className={styles.status} role="status"><LoaderCircle aria-hidden="true" /><span>{t("operationFeedback.operating")}</span></div>}
  </div>;
}

export function OperationOverlayPage() {
  const [feedback, setFeedback] = useState<OperationFeedback>({ active: false });
  const hidden = useCallback(() => window.ohmycode.operationFeedback.hide(), []);
  useEffect(() => window.ohmycode.operationFeedback.onState(setFeedback), []);
  return <OperationOverlay feedback={feedback} native onHidden={hidden} />;
}
