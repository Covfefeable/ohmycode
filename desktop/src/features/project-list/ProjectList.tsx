import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, FolderOpen, LoaderCircle, MoreHorizontal, Plus, Search, Trash2, X } from "lucide-react";
import { useFeedback } from "../feedback";
import { PopoverMenu } from "../../shared/ui/popover-menu";
import { Tooltip } from "../../shared/ui/tooltip";
import { EmptyState } from "../../shared/ui/empty-state";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import styles from "./ProjectList.module.css";
import type { MessageLocation } from "../../entities/conversation/types";

type ProjectListProps = {
  selectedConversationId: string | null;
  onConversationSelect(project: LocalProject, conversation: LocalConversation, location?: MessageLocation): void;
  onConversationDelete(conversationId: string): void;
  refreshToken: number;
  heading: ReactNode;
};

export function ProjectList({ selectedConversationId, onConversationSelect, onConversationDelete, refreshToken, heading }: ProjectListProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useFeedback();
  const [projects, setProjects] = useState<LocalProject[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<{ type: "project"; project: LocalProject } | { type: "conversation"; projectId: string; conversationId: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchRequestRef = useRef(0);
  const revealLabel = navigator.userAgent.includes("Mac") ? t("projects.revealFinder") : t("projects.revealExplorer");

  useEffect(() => {
    let cancelled = false;
    void window.ohmycode.projects.list().then((items) => {
      if (cancelled) return;
      setProjects(items);
      setLoadFailed(false);
    }).catch(() => { if (!cancelled) setLoadFailed(true); });
    return () => { cancelled = true; };
  }, [refreshToken, reloadKey]);

  useEffect(() => {
    const query = searchQuery.trim();
    const requestId = ++searchRequestRef.current;
    if (!query) return;
    const timer = window.setTimeout(() => {
      void window.ohmycode.projects.searchConversations(query)
        .then((items) => {
          if (searchRequestRef.current === requestId) setSearchResults(items);
        })
        .catch(() => {
          if (searchRequestRef.current === requestId) {
            setSearchResults([]);
            toast({ type: "error", message: t("projects.searchFailed") });
          }
        })
        .finally(() => {
          if (searchRequestRef.current === requestId) setSearching(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [refreshToken, searchQuery, t, toast]);

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
    onConversationSelect(project, conversation);
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

  function selectSearchResult(result: ConversationSearchResult) {
    const project = projects.find((item) => item.id === result.projectId);
    if (!project) return;
    setExpanded((current) => new Set(current).add(project.id));
    onConversationSelect(project, result.conversation, result.messageId ? { messageId: result.messageId, query: searchQuery.trim() } : undefined);
  }

  function changeSearchQuery(value: string) {
    searchRequestRef.current += 1;
    setSearchQuery(value);
    setSearchResults([]);
    setSearching(Boolean(value.trim()));
  }

  return <section className={styles.root}>
    <div className={styles.sticky}>
      {heading}
      <button className={styles.create} onClick={() => void createProject()}><Plus />{t("projects.create")}</button>
      <div className={styles.searchBox}>
        <Search />
        <input aria-label={t("projects.search")} placeholder={t("projects.searchPlaceholder")} value={searchQuery} onChange={(event) => changeSearchQuery(event.target.value)} />
        {searching && <LoaderCircle className={styles.searchSpinner} />}
        {!searching && searchQuery && <Tooltip content={t("projects.clearSearch")}><button aria-label={t("projects.clearSearch")} onClick={() => changeSearchQuery("")}><X /></button></Tooltip>}
      </div>
      <p className={styles.label}>{t("projects.title")}</p>
    </div>
    <div className={styles.list}>
      {loadFailed && <div role="alert" className={styles.loadError}>
        <span>{t("projects.loadFailed")}</span>
        <button onClick={() => setReloadKey((key) => key + 1)}>{t("common.retry")}</button>
      </div>}
      {searchQuery.trim() && searchResults.map((result) => <button className={styles.searchResult} key={result.conversation.id} onClick={() => selectSearchResult(result)}>
        <span className={styles.searchResultTitle}>{result.conversation.title}</span>
        <span className={styles.searchResultMeta}>{result.projectName}<time>{new Intl.DateTimeFormat(i18n.language, { month: "short", day: "numeric" }).format(new Date(result.conversation.updatedAt))}</time></span>
        {result.snippet && <span className={styles.searchResultSnippet}>{result.snippet}</span>}
      </button>)}
      {searchQuery.trim() && !searching && searchResults.length === 0 && <EmptyState compact icon={<Search />} title={t("projects.searchEmpty")} />}
      {!searchQuery.trim() && <>
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
              <button className={styles.danger} onClick={() => setDeleteTarget({ type: "project", project })}><Trash2 /><span>{t("projects.delete")}</span></button>
            </PopoverMenu>
          </div>
        </div>
        {expanded.has(project.id) && <div className={styles.conversations}>
          {project.conversations.map((conversation) => <div className={`${styles.conversation} ${selectedConversationId === conversation.id ? styles.conversationActive : ""}`} key={conversation.id}>
            <Tooltip className={styles.conversationName} content={conversation.title}><button onClick={() => onConversationSelect(project, conversation)}>{conversation.title}</button></Tooltip>
            <Tooltip content={t("projects.deleteConversation")}><button className={styles.deleteConversation} aria-label={t("projects.deleteConversation")} onClick={() => setDeleteTarget({ type: "conversation", projectId: project.id, conversationId: conversation.id })}><Trash2 /></button></Tooltip>
          </div>)}
          {project.conversations.length === 0 && <EmptyState compact icon={<FolderOpen />} title={t("projects.noConversations")} />}
        </div>}
      </article>)}
      {projects.length === 0 && !loadFailed && <EmptyState icon={<FolderOpen />} title={t("projects.empty")} description={t("projects.emptyDescription")} />}
      </>}
    </div>
    <ConfirmDialog open={Boolean(deleteTarget)} title={t("common.confirmDelete")} description={t("common.deleteWarning")} onCancel={() => setDeleteTarget(null)} onConfirm={() => {
      const target = deleteTarget; setDeleteTarget(null);
      if (target?.type === "project") void removeProject(target.project);
      if (target?.type === "conversation") void removeConversation(target.projectId, target.conversationId);
    }} />
  </section>;
}
