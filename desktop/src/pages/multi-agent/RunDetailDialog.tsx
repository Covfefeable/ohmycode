import { LoaderCircle, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ActivityTimeline } from "../../features/conversation-chat/activity-timeline/ActivityTimeline";
import styles from "./MultiAgentPage.module.css";

type Props = {
  detail: MultiAgentRunDetail | null;
  loading: boolean;
  onClose(): void;
};

export function RunDetailDialog({ detail, loading, onClose }: Props) {
  const { t } = useTranslation();
  return createPortal(<div className={styles.backdrop} onMouseDown={onClose}>
    <section className={styles.runDialog} role="dialog" aria-modal="true" aria-labelledby="run-detail-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><h2 id="run-detail-title">{t("multiAgent.runDetails")}</h2>{detail && <p>{detail.id}</p>}</div><button aria-label={t("common.close")} onClick={onClose}><X /></button></header>
      {loading ? <div className={styles.runLoading}><LoaderCircle className={styles.spinner} /></div> : detail && <>
        <div className={styles.runMetadata}>
          <span>{t("multiAgent.status")}<strong>{detail.status}</strong></span>
          <span>{t("multiAgent.duration")}<strong>{detail.durationMs == null ? "—" : `${(detail.durationMs / 1000).toFixed(1)}s`}</strong></span>
          <span>{t("multiAgent.inputTokens")}<strong>{detail.inputTokens ?? "—"}</strong></span>
          <span>{t("multiAgent.outputTokens")}<strong>{detail.outputTokens ?? "—"}</strong></span>
        </div>
        {detail.errorCode && <div className={styles.runError}>{detail.errorCode}</div>}
        <div className={styles.runActivity}><ActivityTimeline steps={detail.activity} active={detail.status === "running"} durationMs={detail.durationMs ?? undefined} startedAt={detail.startedAt} /></div>
      </>}
    </section>
  </div>, document.body);
}
