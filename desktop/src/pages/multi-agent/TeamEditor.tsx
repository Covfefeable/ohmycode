import { Bot, Play, Plus, Save, Trash2, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import { Select } from "../../shared/ui/select";
import { PromptEditor, usePromptCapabilities } from "../../shared/ui/prompt-editor";
import styles from "./MultiAgentPage.module.css";

type Props = {
  task: MultiAgentTask;
  models: ModelConfiguration[];
  selectedMember: MultiAgentMemberData | null;
  selectedMemberId: string | null;
  onSelectMember(memberId: string): void;
  onAddMember(): void;
  onRemoveMember(memberId: string): void;
  onUpdateMember(field: "name" | "role" | "instructions" | "modelId", value: string): void;
  onSave(): void;
  onRun(): void;
};

export function TeamEditor(props: Props) {
  const { t } = useTranslation();
  const capabilityOptions = usePromptCapabilities();
  const member = props.selectedMember;
  return <div className={styles.teamEditor}>
    <section className={styles.memberList}>
      <div className={styles.memberHeading}>
        <span><Users />{t("multiAgent.teamMembers")}</span>
        <div className={styles.memberActions}>
          <Tooltip content={t("multiAgent.addAgent")}><button aria-label={t("multiAgent.addAgent")} onClick={props.onAddMember}><Plus /></button></Tooltip>
          <Tooltip content={t("multiAgent.saveTemplate")}><button aria-label={t("multiAgent.saveTemplate")} onClick={props.onSave}><Save /></button></Tooltip>
          <Tooltip content={t("multiAgent.run")}><button className={styles.primary} aria-label={t("multiAgent.run")} onClick={props.onRun}><Play /></button></Tooltip>
        </div>
      </div>
      {props.task.members.map((item) => <button key={item.id} className={props.selectedMemberId === item.id ? styles.selectedMember : ""} onClick={() => props.onSelectMember(item.id)}>
        <span className={styles.avatar}>{item.isHost ? <Bot /> : item.name.slice(0, 1)}</span>
        <span><strong>{item.name}</strong><small>{item.isHost ? t("multiAgent.host") : item.role}</small></span>
      </button>)}
    </section>
    <section className={styles.memberEditor}>{member ? <>
      <div className={styles.editorTitle}>
        <span className={styles.avatar}>{member.isHost ? <Bot /> : member.name.slice(0, 1)}</span>
        <div><h2>{member.name}</h2><p>{member.isHost ? t("multiAgent.hostDescription") : member.role}</p></div>
        {!member.isHost && <button className={styles.deleteMember} title={t("common.delete")} onClick={() => props.onRemoveMember(member.id)}><Trash2 /></button>}
      </div>
      <label>{t("multiAgent.nodeName")}<input value={member.name} onChange={(event) => props.onUpdateMember("name", event.target.value)} /></label>
      <label>{t("multiAgent.nodeRole")}<input value={member.role} onChange={(event) => props.onUpdateMember("role", event.target.value)} /></label>
      <label>{t("multiAgent.nodeModel")}<Select ariaLabel={t("multiAgent.nodeModel")} value={member.modelId ?? ""} options={[
        { value: "", label: t("multiAgent.defaultModel") },
        ...props.models.map((model) => ({ value: model.id, label: `${model.name} - ${model.model}` })),
      ]} onChange={(value) => props.onUpdateMember("modelId", value)} /></label>
      <label>{t("multiAgent.nodeInstructions")}<PromptEditor key={member.id} className={styles.fieldPromptEditor} value={member.instructions} options={capabilityOptions} mentions={props.task.members.map((item) => ({ id: item.id, label: item.name, detail: item.isHost ? t("multiAgent.host") : item.role }))} placeholder={t("multiAgent.nodeInstructionsPlaceholder")} ariaLabel={t("multiAgent.nodeInstructions")} onChange={(value) => props.onUpdateMember("instructions", value)} /></label>
    </> : <div className={styles.editorEmpty}>{t("multiAgent.selectMember")}</div>}</section>
  </div>;
}
