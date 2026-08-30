import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Copy, Info, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import { Tooltip } from "../../shared/ui/tooltip";
import { RunDetailDialog } from "./RunDetailDialog";
import styles from "./MultiAgentPage.module.css";

type Props = {
  task: MultiAgentTask;
  message: string;
  sending: boolean;
  onMessageChange(value: string): void;
  onSend(): void;
};

export function GroupChatPanel(props: Props) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const capabilityOptions = usePromptCapabilities();
  const endRef = useRef<HTMLDivElement>(null);
  const [runDetail, setRunDetail] = useState<MultiAgentRunDetail | null>(null);
  const [runDetailOpen, setRunDetailOpen] = useState(false);
  const [runDetailLoading, setRunDetailLoading] = useState(false);
  const [runDetailMessageId, setRunDetailMessageId] = useState<string | null>(null);
  const names = useMemo(() => new Map(props.task.members.map((member) => [member.id, member.name])), [props.task.members]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [props.task.messages.length]);
  useEffect(() => {
    if (!runDetailOpen || !runDetailMessageId || runDetail?.status !== "running") return;
    const timer = window.setInterval(() => {
      void window.ohmycode.multiAgents.getRunDetail(runDetailMessageId).then(setRunDetail).catch(() => undefined);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [runDetail?.status, runDetailMessageId, runDetailOpen]);

  async function showRunDetail(messageId: string) {
    setRunDetailOpen(true);
    setRunDetailMessageId(messageId);
    setRunDetail(null);
    setRunDetailLoading(true);
    try { setRunDetail(await window.ohmycode.multiAgents.getRunDetail(messageId)); }
    catch {
      setRunDetailOpen(false);
      toast({ type: "error", message: t("multiAgent.runDetailLoadFailed") });
    }
    finally { setRunDetailLoading(false); }
  }

  return <section className={styles.chatPanel}>
    <div className={styles.chatMessages}>
      {props.task.messages.map((item) => {
        const mine = item.senderType === "user";
        const sender = mine ? t("multiAgent.user") : names.get(item.fromNodeId ?? "") ?? t("multiAgent.unknownAgent");
        const target = item.toNodeId ? names.get(item.toNodeId) ?? t("multiAgent.unknownAgent") : t("multiAgent.user");
        return <article className={mine ? styles.userMessage : styles.agentMessage} key={item.id}>
          <span className={styles.messageAvatar}>{mine ? t("multiAgent.youShort") : sender.slice(0, 1)}</span>
          <div>
            <header><strong>{sender}</strong><time>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</time></header>
            <div className={styles.bubble}><b>@{target}</b><MarkdownContent>{item.content}</MarkdownContent></div>
            <div className={styles.messageActions}>
              <Tooltip content={t("common.copy")}><button aria-label={t("common.copy")} onClick={() => void navigator.clipboard.writeText(item.content).then(() => toast({ type: "success", message: t("common.copied") }))}><Copy /></button></Tooltip>
              {item.runId && <Tooltip content={t("multiAgent.details")}><button aria-label={t("multiAgent.details")} onClick={() => void showRunDetail(item.id)}><Info /></button></Tooltip>}
            </div>
          </div>
        </article>;
      })}
      <div ref={endRef} />
    </div>
    <div className={styles.composer}>
      <PromptEditor compact submitOnEnter singleMention className={styles.groupPromptEditor} value={props.message} options={capabilityOptions} mentions={props.task.members.map((member) => ({ id: member.id, label: member.name, detail: member.isHost ? t("multiAgent.host") : member.role }))} placeholder={t("multiAgent.groupMessagePlaceholder")} ariaLabel={t("multiAgent.groupMessagePlaceholder")} onChange={props.onMessageChange} onSubmit={props.onSend} />
      <div className={styles.composerToolbar}><button aria-label={t("multiAgent.send")} disabled={props.sending || !props.message.trim()} onClick={props.onSend}>
        {props.sending ? <LoaderCircle className={styles.spinner} /> : <ArrowUp />}
      </button></div>
    </div>
    {runDetailOpen && <RunDetailDialog detail={runDetail} loading={runDetailLoading} onClose={() => { setRunDetailOpen(false); setRunDetail(null); setRunDetailMessageId(null); }} />}
  </section>;
}
