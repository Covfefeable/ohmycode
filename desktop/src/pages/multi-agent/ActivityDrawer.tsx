import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import styles from "./MultiAgentPage.module.css";

type Props = { member: MultiAgentMemberData; models: ModelConfiguration[]; onClose(): void };

export function ActivityDrawer({ member, models, onClose }: Props) {
  const { t } = useTranslation();
  const model = models.find((item) => item.id === member.modelId);
  return <aside className={styles.activityDrawer}>
    <header className={styles.drawerHeader}>
      <button className={styles.close} onClick={onClose}><X /></button>
      <h2>{member.name}</h2>
      <p>{member.role}</p>
    </header>
    <div className={styles.memberDetails}>
      <section><span>{t("multiAgent.nodeName")}</span><strong>{member.name}</strong></section>
      <section><span>{t("multiAgent.nodeRole")}</span><p>{member.role}</p></section>
      <section><span>{t("multiAgent.nodeModel")}</span><p>{model ? `${model.name} · ${model.model}` : t("multiAgent.defaultModel")}</p></section>
      <section><span>{t("multiAgent.status")}</span><p>{t(`multiAgent.${member.status}`, { defaultValue: member.status })}</p></section>
      <section><span>{t("multiAgent.nodeInstructions")}</span><div className={styles.instructions}><MarkdownContent>{member.instructions}</MarkdownContent></div></section>
    </div>
  </aside>;
}
