import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FolderOpen, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useFeedback } from "../feedback";
import { PopoverMenu } from "../../shared/ui/popover-menu";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./ProjectList.module.css";

type ProjectListProps = {
  selectedConversationId: string | null;
  onConversationSelect(project: LocalProject, conversation: LocalConversation): void;
  onConversationDelete(conversationId: string): void;
  refreshToken: number;
  heading: ReactNode;
};

export function ProjectList({ selectedConversationId, onConversationSelect, onConversationDelete, refreshToken, heading }: ProjectListProps) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const revealLabel = navigator.userAgent.includes("Mac") ? t("projects.revealFinder") : t("projects.revealExplorer");

  useEffect(() => { void window.ohmycode.projects.list().then(setProjects); }, [refreshToken]);

  function toggle(project: LocalProject) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(project.id)) next.delete(project.id); else next.add(project.id);
      return next;
    });
  }

  async function createProject() {
    const result = await window.ohmycode.projects.create();
    if (!result.ok) {
      if (result.reason === "exists") toast({ type: "info", message: t("projects.exists") });
      return;
    }
    setProjects((items) => [...items, result.project]);
    setExpanded((current) => new Set(current).add(result.project.id));
  }

  async function addConversation(project: LocalProject) {
    const conversation = await window.ohmycode.projects.createConversation(project.id, t("projects.untitledConversation"));
    setProjects((items) => items.map((item) => item.id === project.id ? { ...item, conversations: [...item.conversations, conversation] } : item));
    setExpanded((current) => new Set(current).add(project.id));
  }

  async function removeProject(project: LocalProject) {
    await window.ohmycode.projects.delete(project.id);
    setProjects((items) => items.filter((item) => item.id !== project.id));
    toast({ type: "success", message: t("projects.removed") });
  }

  async function removeConversation(projectId: string, conversationId: string) {
    await window.ohmycode.projects.deleteConversation(projectId, conversationId);
    setProjects((items) => items.map((item) => item.id === projectId ? { ...item, conversations: item.conversations.filter((conversation) => conversation.id !== conversationId) } : item));
    onConversationDelete(conversationId);
  }

  return <section className={styles.root}>
    <div className={styles.sticky}>
      {heading}
      <button className={styles.create} onClick={() => void createProject()}><Plus />{t("projects.create")}</button>
      <p className={styles.label}>{t("projects.title")}</p>
    </div>
    <div className={styles.list}>
      {projects.map((project) => <article key={project.id} className={styles.project}>
        <div className={styles.projectRow}>
          <button className={styles.projectMain} onClick={() => toggle(project)}>
            {expanded.has(project.id) ? <ChevronDown /> : <ChevronRight />}
            <Tooltip className={styles.projectName} content={project.path}><span>{project.name}</span></Tooltip>
          </button>
          <div className={styles.projectActions}>
            <Tooltip content={t("projects.newConversation")}><button aria-label={t("projects.newConversation")} onClick={() => void addConversation(project)}><Plus /></button></Tooltip>
            <PopoverMenu trigger={<Tooltip content={t("projects.more")}><button aria-label={t("projects.more")}><MoreHorizontal /></button></Tooltip>}>
              <button onClick={() => void window.ohmycode.projects.open(project.id)}><FolderOpen /><span>{revealLabel}</span></button>
              <button className={styles.danger} onClick={() => void removeProject(project)}><Trash2 /><span>{t("projects.delete")}</span></button>
            </PopoverMenu>
          </div>
        </div>
        {expanded.has(project.id) && <div className={styles.conversations}>
          {project.conversations.map((conversation) => <div className={`${styles.conversation} ${selectedConversationId === conversation.id ? styles.conversationActive : ""}`} key={conversation.id}>
            <Tooltip className={styles.conversationName} content={conversation.title}><button onClick={() => onConversationSelect(project, conversation)}>{conversation.title}</button></Tooltip>
            <Tooltip content={t("projects.deleteConversation")}><button className={styles.deleteConversation} aria-label={t("projects.deleteConversation")} onClick={() => void removeConversation(project.id, conversation.id)}><Trash2 /></button></Tooltip>
          </div>)}
          {project.conversations.length === 0 && <span className={styles.empty}>{t("projects.noConversations")}</span>}
        </div>}
      </article>)}
      {projects.length === 0 && <p className={styles.empty}>{t("projects.empty")}</p>}
    </div>
  </section>;
}
