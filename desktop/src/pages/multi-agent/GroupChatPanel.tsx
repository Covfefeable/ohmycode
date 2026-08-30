import { useEffect, useMemo, useRef } from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
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
  const capabilityOptions = usePromptCapabilities();
  const endRef = useRef<HTMLDivElement>(null);
  const names = useMemo(() => new Map(props.task.members.map((member) => [member.id, member.name])), [props.task.members]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [props.task.messages.length]);

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
  </section>;
}
