import { FolderOpen, LoaderCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { CollaborationDraft } from "./multi-agent-utils";
import styles from "./MultiAgentPage.module.css";

type CreateProps = {
  open: boolean;
  creating: boolean;
  draft: CollaborationDraft;
  onDraftChange(draft: CollaborationDraft): void;
  onClose(): void;
  onCreate(): void;
};

export function CreateCollaborationDialog(props: CreateProps) {
  const { t } = useTranslation();
  if (!props.open) return null;
  const complete = props.draft.name.trim() && props.draft.description.trim() && props.draft.division.trim();
  return <div className={styles.backdrop} onMouseDown={() => { if (!props.creating) props.onClose(); }}>
    <section className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{t("multiAgent.createCollaboration")}</h2><button onClick={props.onClose}><X /></button></header>
      <label>{t("multiAgent.collaborationName")}<input autoFocus value={props.draft.name} onChange={(event) => props.onDraftChange({ ...props.draft, name: event.target.value })} /></label>
      <label>{t("multiAgent.collaborationDescription")}<textarea value={props.draft.description} onChange={(event) => props.onDraftChange({ ...props.draft, description: event.target.value })} /></label>
      <label>{t("multiAgent.division")}<textarea value={props.draft.division} onChange={(event) => props.onDraftChange({ ...props.draft, division: event.target.value })} /></label>
      <footer>
        <button onClick={props.onClose}>{t("multiAgent.cancel")}</button>
        <button className={styles.primary} disabled={props.creating || !complete} onClick={props.onCreate}>{props.creating && <LoaderCircle className={styles.spinner} />}{t("multiAgent.generateCollaboration")}</button>
      </footer>
    </section>
  </div>;
}

type RunProps = {
  open: boolean;
  description: string;
  workspacePath: string;
  onDescriptionChange(value: string): void;
  onWorkspaceChange(value: string): void;
  onClose(): void;
  onRun(): void;
};

export function RunTaskDialog(props: RunProps) {
  const { t } = useTranslation();
  if (!props.open) return null;
  return <div className={styles.backdrop} onMouseDown={props.onClose}>
    <section className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
      <header><h2>{t("multiAgent.runTaskTitle")}</h2><button onClick={props.onClose}><X /></button></header>
      <label>{t("multiAgent.runRequirement")}<textarea autoFocus value={props.description} onChange={(event) => props.onDescriptionChange(event.target.value)} /></label>
      <label>{t("multiAgent.workspaceDirectory")}<button className={styles.directoryPicker} onClick={() => void window.ohmycode.multiAgents.selectWorkspace().then((value) => { if (value) props.onWorkspaceChange(value); })}>
        <FolderOpen /><span>{props.workspacePath || t("multiAgent.chooseDirectory")}</span>
      </button></label>
      <footer>
        <button onClick={props.onClose}>{t("multiAgent.cancel")}</button>
        <button className={styles.primary} disabled={!props.description.trim() || !props.workspacePath} onClick={props.onRun}>{t("multiAgent.start")}</button>
      </footer>
    </section>
  </div>;
}
