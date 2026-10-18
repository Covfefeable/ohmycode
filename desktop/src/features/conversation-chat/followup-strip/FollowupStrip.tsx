import { FastForward, LoaderCircle, Play, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { FollowupState } from "@ohmycode/protocol";
import { IconButton } from "../../../shared/ui/icon-button";
import { Tooltip } from "../../../shared/ui/tooltip";
import styles from "./FollowupStrip.module.css";

type Props = { state: FollowupState; running: boolean; onSteer(id: string): void; onWithdraw(id: string): void; onResume(): void };

export function FollowupStrip({ state, running, onSteer, onWithdraw, onResume }: Props) {
  const { t } = useTranslation();
  if (!state.inputs.length) return null;
  return <div className={styles.queue} aria-label={t("agent.queuedMessages")}>
    {state.paused && <div className={styles.paused}><span>{t("agent.queuePaused")}</span><Tooltip content={t("agent.resumeQueue")}><IconButton aria-label={t("agent.resumeQueue")} onClick={onResume}><Play /></IconButton></Tooltip></div>}
    {state.inputs.map((input) => <div className={styles.row} key={input.id}>
      {input.status !== "queued" && <LoaderCircle className={styles.spinner} />}
      <Tooltip content={input.content || input.attachments.map((item) => item.name).join(", ")}><span className={styles.text}>{input.content || input.attachments.map((item) => item.name).join(", ")}</span></Tooltip>
      {input.attachments.length > 0 && input.content && <span className={styles.count}>{t("agent.queuedAttachments", { count: input.attachments.length })}</span>}
      {input.status !== "queued" ? <span className={styles.status}>{t(input.status === "steering" ? "agent.steerWaiting" : "agent.queueSending")}</span> : <>
        <Tooltip content={t("agent.steer")}><IconButton aria-label={t("agent.steer")} disabled={!running} onClick={() => onSteer(input.id)}><FastForward /></IconButton></Tooltip>
        <Tooltip content={t("agent.withdraw")}><IconButton aria-label={t("agent.withdraw")} onClick={() => onWithdraw(input.id)}><Undo2 /></IconButton></Tooltip>
      </>}
    </div>)}
  </div>;
}
