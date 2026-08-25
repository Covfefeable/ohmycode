import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Bot, FolderOpen, LoaderCircle, Play, Plus, Save, Square, Trash2, Users, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { MultiAgentSidebar } from "../../features/multi-agent-sidebar";
import { ActivityTimeline } from "../../features/conversation-chat/activity-timeline/ActivityTimeline";
import { updateActivity, withoutFinalResponse } from "../../features/conversation-chat/activity-timeline/updateActivity";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { MarkdownContent } from "../../shared/ui/markdown-content";
import { Tooltip } from "../../shared/ui/tooltip";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import styles from "./MultiAgentPage.module.css";

type CollaborationDraft = { name: string; description: string; division: string };
const emptyDraft: CollaborationDraft = { name: "", description: "", division: "" };

export function MultiAgentPage() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [agents, setAgents] = useState<MultiAgentSummary[]>([]);
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<MultiAgentTask | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<CollaborationDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runDescription, setRunDescription] = useState("");
  const [runWorkspacePath, setRunWorkspacePath] = useState("");
  const [runRequestId, setRunRequestId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Record<string, AgentActivityStep[]>>({});
  const [message, setMessage] = useState("");
  const [mentionTargetId, setMentionTargetId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: "agent" | "task"; id: string } | null>(null);

  const reloadAgents = useCallback(async () => {
    const value = await window.ohmycode.multiAgents.list();
    setAgents(value);
    return value;
  }, []);

  useEffect(() => {
    void Promise.all([window.ohmycode.multiAgents.list(), window.ohmycode.settings.get()])
      .then(([items, settings]) => { setAgents(items); setModels(settings.models); })
      .catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
  }, [t, toast]);

  useEffect(() => {
    if (!selectedTaskId) return;
    void window.ohmycode.multiAgents.getTask(selectedTaskId).then(setTask)
      .catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
  }, [selectedTaskId, t, toast]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ block: "end" }); }, [task?.messages.length]);

  const selectedAgent = agents.find((item) => item.id === selectedAgentId) ?? null;
  const selectedMember = task?.members.find((item) => item.id === selectedMemberId) ?? null;
  const names = useMemo(() => new Map(task?.members.map((item) => [item.id, item.name]) ?? []), [task]);
  const mentionMembers = useMemo(() => {
    if (!task || mentionQuery === null) return [];
    const query = mentionQuery.trim().toLocaleLowerCase();
    return task.members.filter((member) => !query || member.name.toLocaleLowerCase().includes(query));
  }, [mentionQuery, task]);

  function templateTask(agent: MultiAgentSummary): MultiAgentTask {
    return { id: `template:${agent.id}`, agentId: agent.id, title: agent.name, request: agent.description,
      status: "template", workspacePath: "", currentSpeakerId: null, messages: [],
      members: agent.templateTeam.members.map((member) => ({ ...member, id: member.key, status: "idle", changedFiles: [] })),
      createdAt: agent.createdAt, updatedAt: agent.createdAt };
  }

  function selectAgent(agentId: string, source = agents) {
    const agent = source.find((item) => item.id === agentId);
    if (!agent) return;
    setSelectedAgentId(agentId); setSelectedTaskId(null); setSelectedMemberId(null); setTask(templateTask(agent));
  }

  async function createCollaboration() {
    if (!draft.name.trim() || !draft.description.trim() || !draft.division.trim()) return;
    setCreating(true);
    try {
      const created = await window.ohmycode.multiAgents.create(draft);
      if (!created.templateTeam.members.length) throw new Error("empty_team");
      const source = [...agents.filter((item) => item.id !== created.id), created];
      setAgents(source); selectAgent(created.id, source); setDialogOpen(false); setDraft(emptyDraft);
      void reloadAgents();
    } catch { toast({ type: "error", message: t("multiAgent.planFailed") }); }
    finally { setCreating(false); }
  }

  async function saveTeam() {
    if (!selectedAgent || !task) return;
    const updated = await window.ohmycode.multiAgents.update(selectedAgent.id, {
      templateTeam: { title: task.title, members: task.members.map(({ key, name, role, instructions, modelId, isHost, sortOrder }) => ({ key, name, role, instructions, modelId, isHost, sortOrder })) },
    } as Partial<MultiAgentSummary>);
    setAgents((items) => items.map((item) => item.id === updated.id ? updated : item));
    setTask(templateTask(updated));
    toast({ type: "success", message: t("multiAgent.saved") });
  }

  function updateMember(field: "name" | "role" | "instructions" | "modelId", value: string) {
    if (!task || !selectedMemberId) return;
    setTask({ ...task, members: task.members.map((member) => member.id === selectedMemberId ? { ...member, [field]: field === "modelId" ? value || null : value } : member) });
  }

  function addMember() {
    if (!task) return;
    const key = `agent_${crypto.randomUUID().slice(0, 8)}`;
    setTask({ ...task, members: [...task.members, { id: key, key, name: t("multiAgent.newAgentNode"), role: t("multiAgent.newAgentRole"), instructions: "", isHost: false, sortOrder: task.members.length, status: "idle", changedFiles: [] }] });
    setSelectedMemberId(key);
  }

  function removeMember(memberId: string) {
    if (!task) return;
    const member = task.members.find((item) => item.id === memberId);
    if (!member || member.isHost) return;
    setTask({ ...task, members: task.members.filter((item) => item.id !== memberId).map((item, index) => ({ ...item, sortOrder: index })) });
    if (selectedMemberId === memberId) setSelectedMemberId(null);
  }

  async function executeTask(target: MultiAgentTask) {
    const requestId = crypto.randomUUID();
    setRunRequestId(requestId);
    const unsubscribe = window.ohmycode.multiAgents.onEvent(requestId, (event) => {
      if (event.type === "task.updated") setTask(event.task);
      if (event.type === "node.event") setActivities((current) => ({ ...current, [event.nodeId]: updateActivity(current[event.nodeId] ?? [], event.event) }));
    });
    try { setTask(await window.ohmycode.multiAgents.runTask(target.id, requestId)); await reloadAgents(); }
    catch { toast({ type: "error", message: t("multiAgent.runFailed") }); setTask(await window.ohmycode.multiAgents.getTask(target.id)); }
    finally { unsubscribe(); setRunRequestId(null); await reloadAgents(); }
  }

  async function runCollaboration() {
    if (!selectedAgentId || !runDescription.trim() || !runWorkspacePath) return;
    const created = await window.ohmycode.multiAgents.createTask(selectedAgentId, runDescription, runWorkspacePath);
    setRunDialogOpen(false); setRunDescription(""); setRunWorkspacePath(""); setActivities({});
    setSelectedTaskId(created.id); setTask(created); setMentionTargetId(null); setMentionQuery(null);
    await reloadAgents(); await executeTask(created);
  }

  async function sendGroupMessage() {
    if (!task || !message.trim()) return;
    const target = task.members.find((item) => item.id === mentionTargetId);
    const targetId = target?.id || task.members.find((item) => item.isHost)?.id;
    if (!targetId) return;
    const content = target
      ? message.replace(new RegExp(`^@${target.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "").trim()
      : message.trim();
    if (!content) return;
    setSending(true);
    try { setTask(await window.ohmycode.multiAgents.sendMessage(task.id, targetId, content)); setMessage(""); setMentionTargetId(null); setMentionQuery(null); }
    catch { toast({ type: "error", message: t("multiAgent.adjustFailed") }); }
    finally { setSending(false); }
  }

  function changeGroupMessage(value: string) {
    setMessage(value);
    if (mentionTargetId) {
      const target = task?.members.find((item) => item.id === mentionTargetId);
      if (!target || !value.startsWith(`@${target.name}`)) setMentionTargetId(null);
    }
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    setMentionQuery(match ? match[1] : null);
  }

  function selectMention(member: MultiAgentMemberData) {
    const selectedTarget = task?.members.find((item) => item.id === mentionTargetId);
    const withoutSelected = selectedTarget
      ? message.replace(new RegExp(`^@${selectedTarget.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`), "")
      : message;
    const next = withoutSelected.replace(/(?:^|\s)@[^\s@]*$/, "").trimStart();
    setMessage(`@${member.name} ${next}`);
    setMentionTargetId(member.id);
    setMentionQuery(null);
  }

  async function stopTask() {
    if (!task) return;
    await window.ohmycode.multiAgents.stopTask(runRequestId, task.id);
    setTask(await window.ohmycode.multiAgents.getTask(task.id));
    await reloadAgents();
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget; setDeleteTarget(null);
    try {
      if (target.type === "agent") { await window.ohmycode.multiAgents.delete(target.id); if (selectedAgentId === target.id) { setTask(null); setSelectedAgentId(null); setSelectedTaskId(null); } }
      else { await window.ohmycode.multiAgents.deleteTask(target.id); if (selectedTaskId === target.id) { setTask(null); setSelectedTaskId(null); } }
      await reloadAgents();
    } catch { toast({ type: "error", message: t("multiAgent.deleteFailed") }); }
  }

  const isTemplate = task?.status === "template";
  return <AppShell navigation={<NavigationRail />} sidebar={<MultiAgentSidebar
    agents={agents} selectedAgentId={selectedAgentId} selectedTaskId={selectedTaskId} busy={creating}
    onCreateAgent={() => setDialogOpen(true)} onSelectAgent={selectAgent}
    onRunAgent={(id) => { setSelectedAgentId(id); setRunDialogOpen(true); }}
    onSelectTask={(id) => { setSelectedTaskId(id); setSelectedMemberId(null); }}
    onDeleteAgent={(id) => setDeleteTarget({ type: "agent", id })} onDeleteTask={(id) => setDeleteTarget({ type: "task", id })}
  />}>
    <main className={styles.page}>
      {task ? <>
        <header className={styles.header}><div><h1>{task.title}</h1><p>{task.request}</p></div></header>
        {isTemplate ? <div className={styles.teamEditor}>
          <section className={styles.memberList}>
            <div className={styles.memberHeading}>
              <span><Users />{t("multiAgent.teamMembers")}</span>
              <div className={styles.memberActions}>
                <Tooltip content={t("multiAgent.addAgent")}><button aria-label={t("multiAgent.addAgent")} onClick={addMember}><Plus /></button></Tooltip>
                <Tooltip content={t("multiAgent.saveTemplate")}><button aria-label={t("multiAgent.saveTemplate")} onClick={() => void saveTeam()}><Save /></button></Tooltip>
                <Tooltip content={t("multiAgent.run")}><button className={styles.primary} aria-label={t("multiAgent.run")} onClick={() => setRunDialogOpen(true)}><Play /></button></Tooltip>
              </div>
            </div>
            {task.members.map((member) => <button key={member.id} className={selectedMemberId === member.id ? styles.selectedMember : ""} onClick={() => setSelectedMemberId(member.id)}><span className={styles.avatar}>{member.isHost ? <Bot /> : member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.isHost ? t("multiAgent.host") : member.role}</small></span></button>)}
          </section>
          <section className={styles.memberEditor}>{selectedMember ? <><div className={styles.editorTitle}><span className={styles.avatar}>{selectedMember.isHost ? <Bot /> : selectedMember.name.slice(0, 1)}</span><div><h2>{selectedMember.name}</h2><p>{selectedMember.isHost ? t("multiAgent.hostDescription") : selectedMember.role}</p></div>{!selectedMember.isHost && <button className={styles.deleteMember} title={t("common.delete")} onClick={() => removeMember(selectedMember.id)}><Trash2 /></button>}</div><label>{t("multiAgent.nodeName")}<input value={selectedMember.name} onChange={(e) => updateMember("name", e.target.value)} /></label><label>{t("multiAgent.nodeRole")}<input value={selectedMember.role} onChange={(e) => updateMember("role", e.target.value)} /></label><label>{t("multiAgent.nodeModel")}<select value={selectedMember.modelId ?? ""} onChange={(e) => updateMember("modelId", e.target.value)}><option value="">{t("multiAgent.defaultModel")}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} - {model.model}</option>)}</select></label><label>{t("multiAgent.nodeInstructions")}<textarea value={selectedMember.instructions} onChange={(e) => updateMember("instructions", e.target.value)} /></label></> : <div className={styles.editorEmpty}>{t("multiAgent.selectMember")}</div>}</section>
        </div> : <div className={styles.chatLayout}>
          <section className={styles.chatPanel}>
            <div className={styles.chatMessages}>{task.messages.map((item) => { const mine = item.senderType === "user"; const sender = mine ? t("multiAgent.user") : names.get(item.fromNodeId ?? "") ?? t("multiAgent.unknownAgent"); const target = names.get(item.toNodeId) ?? t("multiAgent.host"); return <article className={mine ? styles.userMessage : styles.agentMessage} key={item.id}><span className={styles.messageAvatar}>{mine ? t("multiAgent.youShort") : sender.slice(0, 1)}</span><div><header><strong>{sender}</strong><time>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(item.createdAt))}</time></header><div className={styles.bubble}>{item.type !== "final" && <b>@{target}</b>}<MarkdownContent>{item.content}</MarkdownContent></div></div></article>; })}<div ref={chatEndRef} /></div>
            <div className={styles.composer}>
              {mentionQuery !== null && <div className={styles.mentionMenu}>{mentionMembers.length ? mentionMembers.map((member) => <button key={member.id} onMouseDown={(event) => event.preventDefault()} onClick={() => selectMention(member)}><span className={styles.avatar}>{member.isHost ? <Bot /> : member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.isHost ? t("multiAgent.host") : member.role}</small></span></button>) : <span className={styles.noMention}>{t("multiAgent.unknownAgent")}</span>}</div>}
              <textarea rows={1} value={message} placeholder={t("multiAgent.groupMessagePlaceholder")} onChange={(e) => changeGroupMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Escape") setMentionQuery(null); if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) { e.preventDefault(); void sendGroupMessage(); } }} />
              <div className={styles.composerToolbar}><button aria-label={t("multiAgent.send")} disabled={sending || !message.trim()} onClick={() => void sendGroupMessage()}>{sending ? <LoaderCircle className={styles.spinner} /> : <ArrowUp />}</button></div>
            </div>
          </section>
          <aside className={styles.roster}><div className={styles.rosterHeading}><h2>{t("multiAgent.teamMembers")}</h2><div className={styles.taskActions}>{(runRequestId || task.status === "running") && <Tooltip content={t("multiAgent.stop")}><button aria-label={t("multiAgent.stop")} onClick={() => void stopTask()}><Square /></button></Tooltip>}{["completed", "failed", "stopped"].includes(task.status) && <Tooltip content={t("multiAgent.rerun")}><button aria-label={t("multiAgent.rerun")} onClick={() => void executeTask(task)}><Play /></button></Tooltip>}</div></div>{task.members.map((member) => <button key={member.id} className={selectedMemberId === member.id ? styles.selectedMember : ""} onClick={() => setSelectedMemberId(member.id)}><span className={styles.avatar}>{member.isHost ? <Bot /> : member.name.slice(0, 1)}</span><span><strong>{member.name}</strong><small>{member.isHost ? t("multiAgent.host") : t(`multiAgent.${member.status}`, { defaultValue: member.status })}</small></span><i className={`${styles.state} ${styles[member.status]}`} /></button>)}</aside>
          {selectedMember && <aside className={styles.activityDrawer}><button className={styles.close} onClick={() => setSelectedMemberId(null)}><X /></button><h2>{selectedMember.name}</h2><p>{selectedMember.role}</p>{(() => { const persisted = (selectedMember.finalOutput?.activity as AgentActivityStep[] | undefined) ?? []; const finalText = typeof selectedMember.finalOutput?.content === "string" ? selectedMember.finalOutput.content : ""; const steps = withoutFinalResponse(activities[selectedMember.id] ?? persisted, finalText); return <>{steps.length ? <ActivityTimeline steps={steps} active={selectedMember.status === "running"} durationMs={selectedMember.agentDurationMs} startedAt={selectedMember.agentStartedAt ?? undefined} /> : <span className={styles.noActivity}>{t("multiAgent.waitingForActivity")}</span>}{finalText && <div className={styles.finalOutput}><MarkdownContent>{finalText}</MarkdownContent></div>}</>; })()}</aside>}
        </div>}
      </> : <div className={styles.welcome}><div className={styles.promptMark}>›_</div><p>{t("multiAgent.collaboration")}</p><h1>{t("multiAgent.welcomeTitle")}</h1><span>{t("multiAgent.welcomeDescriptionChat")}</span></div>}

      {dialogOpen && <div className={styles.backdrop} onMouseDown={() => !creating && setDialogOpen(false)}><section className={styles.dialog} onMouseDown={(e) => e.stopPropagation()}><header><h2>{t("multiAgent.createCollaboration")}</h2><button onClick={() => setDialogOpen(false)}><X /></button></header><label>{t("multiAgent.collaborationName")}<input autoFocus value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label><label>{t("multiAgent.collaborationDescription")}<textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label><label>{t("multiAgent.division")}<textarea value={draft.division} onChange={(e) => setDraft({ ...draft, division: e.target.value })} /></label><footer><button onClick={() => setDialogOpen(false)}>{t("multiAgent.cancel")}</button><button className={styles.primary} disabled={creating || !draft.name.trim() || !draft.description.trim() || !draft.division.trim()} onClick={() => void createCollaboration()}>{creating && <LoaderCircle className={styles.spinner} />}{t("multiAgent.generateCollaboration")}</button></footer></section></div>}
      {runDialogOpen && selectedAgentId && <div className={styles.backdrop} onMouseDown={() => setRunDialogOpen(false)}><section className={styles.dialog} onMouseDown={(e) => e.stopPropagation()}><header><h2>{t("multiAgent.runTaskTitle")}</h2><button onClick={() => setRunDialogOpen(false)}><X /></button></header><label>{t("multiAgent.runRequirement")}<textarea autoFocus value={runDescription} onChange={(e) => setRunDescription(e.target.value)} /></label><label>{t("multiAgent.workspaceDirectory")}<button className={styles.directoryPicker} onClick={() => void window.ohmycode.multiAgents.selectWorkspace().then((value) => value && setRunWorkspacePath(value))}><FolderOpen /><span>{runWorkspacePath || t("multiAgent.chooseDirectory")}</span></button></label><footer><button onClick={() => setRunDialogOpen(false)}>{t("multiAgent.cancel")}</button><button className={styles.primary} disabled={!runDescription.trim() || !runWorkspacePath} onClick={() => void runCollaboration()}>{t("multiAgent.start")}</button></footer></section></div>}
      <ConfirmDialog open={Boolean(deleteTarget)} title={t("common.confirmDelete")} description={t("common.deleteWarning")} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
    </main>
  </AppShell>;
}
