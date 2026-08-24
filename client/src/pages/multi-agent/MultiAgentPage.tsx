import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, FolderOpen, LoaderCircle, Play, Plus, Redo2, Save, Square, Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useFeedback } from "../../features/feedback";
import { MultiAgentSidebar } from "../../features/multi-agent-sidebar";
import { WorkflowCanvas } from "../../features/workflow-canvas";
import { ActivityTimeline } from "../../features/conversation-chat/activity-timeline/ActivityTimeline";
import { updateActivity } from "../../features/conversation-chat/activity-timeline/updateActivity";
import { withoutFinalResponse } from "../../features/conversation-chat/activity-timeline/updateActivity";
import { MessageComposer } from "../../features/message-composer";
import { ConfirmDialog } from "../../shared/ui/confirm-dialog";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import styles from "./MultiAgentPage.module.css";

type CollaborationDraft = { name: string; description: string; division: string };
const emptyDraft: CollaborationDraft = { name: "", description: "", division: "" };
const START_KEY = "workflow_start";
const END_KEY = "workflow_end";

function withBoundaryFlow(flow: MultiAgentTemplateFlow): MultiAgentTemplateFlow {
  if (flow.nodes.some((node) => node.key === START_KEY) && flow.nodes.some((node) => node.key === END_KEY)) return flow;
  const incoming = new Set(flow.edges.map((edge) => edge.target));
  const outgoing = new Set(flow.edges.map((edge) => edge.source));
  const minX = Math.min(...flow.nodes.map((node) => node.position.x), 120);
  const maxX = Math.max(...flow.nodes.map((node) => node.position.x), 120);
  return {
    ...flow,
    nodes: [
      { key: START_KEY, name: "Start", role: "Workflow entry", instructions: "Starts all root agents.", position: { x: minX - 300, y: 100 } },
      ...flow.nodes,
      { key: END_KEY, name: "End", role: "Workflow completion", instructions: "Waits for all terminal agents.", position: { x: maxX + 330, y: 100 } },
    ],
    edges: [
      ...flow.edges,
      ...flow.nodes.filter((node) => !incoming.has(node.key)).map((node) => ({ source: START_KEY, target: node.key })),
      ...flow.nodes.filter((node) => !outgoing.has(node.key)).map((node) => ({ source: node.key, target: END_KEY })),
    ],
  };
}

function templateAsTask(agent: MultiAgentSummary): MultiAgentTask {
  const flow = withBoundaryFlow(agent.templateFlow);
  return {
    id: `template:${agent.id}`, agentId: agent.id, title: agent.name,
    request: agent.description, status: "template", workspacePath: "",
    nodes: flow.nodes.map((node) => ({
      ...node, id: node.key, status: "template", messages: [], changedFiles: [],
    })),
    edges: flow.edges.map((edge, index) => ({
      id: `template-edge-${index}`, source: edge.source, target: edge.target,
    })),
    createdAt: agent.createdAt, updatedAt: agent.createdAt,
  };
}

export function MultiAgentPage() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [agents, setAgents] = useState<MultiAgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<MultiAgentTask | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [draft, setDraft] = useState<CollaborationDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [runRequestId, setRunRequestId] = useState<string | null>(null);
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runDescription, setRunDescription] = useState("");
  const [runWorkspacePath, setRunWorkspacePath] = useState("");
  const [activityOpen, setActivityOpen] = useState(false);
  const [activityNodeId, setActivityNodeId] = useState<string | null>(null);
  const [nodeActivities, setNodeActivities] = useState<Record<string, AgentActivityStep[]>>({});
  const [undoStack, setUndoStack] = useState<MultiAgentTask[]>([]);
  const [redoStack, setRedoStack] = useState<MultiAgentTask[]>([]);
  const [adjustment, setAdjustment] = useState("");
  const [adjusting, setAdjusting] = useState(false);
  const [activityView, setActivityView] = useState<"agent" | "group">("agent");
  const [deleteTarget, setDeleteTarget] = useState<{ type: "agent"; id: string } | { type: "task"; id: string } | { type: "nodes"; ids: string[] } | { type: "edges"; ids: string[] } | null>(null);

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
    void window.ohmycode.multiAgents.getTask(selectedTaskId).then((value) => {
      setTask(value);
      setPositions(Object.fromEntries(value.nodes.map((node) => [node.id, node.position])));
    }).catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
  }, [selectedTaskId, t, toast]);

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId],
  );
  const selectedNode = useMemo(
    () => task?.nodes.find((node) => node.id === selectedNodeId) ?? null,
    [task, selectedNodeId],
  );
  const isTemplate = task?.status === "template";
  const groupMessages = useMemo(() => {
    if (!task) return [];
    const names = new Map(task.nodes.map((node) => [node.id, node.name]));
    const unique = new Map<string, MultiAgentMessage>();
    for (const node of task.nodes) for (const message of node.messages) unique.set(message.id, message);
    return [...unique.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((message) => ({
      ...message,
      fromName: message.senderType === "user" ? t("multiAgent.user") : names.get(message.fromNodeId ?? "") ?? t("multiAgent.unknownAgent"),
      toName: names.get(message.toNodeId) ?? t("multiAgent.unknownAgent"),
    }));
  }, [task, t]);

  const resetRunDialog = useCallback(() => {
    setRunDialogOpen(false); setRunDescription(""); setRunWorkspacePath("");
  }, []);

  function commitCanvas(next: MultiAgentTask) {
    if (!task) return;
    setUndoStack((items) => [...items.slice(-49), task]);
    setRedoStack([]);
    setTask(next);
    setPositions(Object.fromEntries(next.nodes.map((node) => [node.id, node.position])));
  }

  function undoCanvas() {
    const previous = undoStack.at(-1);
    if (!task || !previous) return;
    setUndoStack((items) => items.slice(0, -1)); setRedoStack((items) => [...items, task]);
    setTask(previous); setPositions(Object.fromEntries(previous.nodes.map((node) => [node.id, node.position])));
  }

  function redoCanvas() {
    const next = redoStack.at(-1);
    if (!task || !next) return;
    setRedoStack((items) => items.slice(0, -1)); setUndoStack((items) => [...items, task]);
    setTask(next); setPositions(Object.fromEntries(next.nodes.map((node) => [node.id, node.position])));
  }

  useEffect(() => {
    if (!isTemplate) return;
    const handleKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redoCanvas(); else undoCanvas();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  });

  function selectAgent(agentId: string, source = agents) {
    const agent = source.find((item) => item.id === agentId);
    if (!agent) return;
    const template = templateAsTask(agent);
    setSelectedAgentId(agentId); setSelectedTaskId(null); setSelectedNodeId(null);
    setTask(template);
    setUndoStack([]); setRedoStack([]);
    setPositions(Object.fromEntries(template.nodes.map((node) => [node.id, node.position])));
  }

  async function createCollaboration() {
    if (!draft.name.trim() || !draft.description.trim() || !draft.division.trim()) return;
    setCreating(true);
    try {
      const created = await window.ohmycode.multiAgents.create(draft);
      if (!created.templateFlow?.nodes?.length) throw new Error("empty_collaboration_flow");
      setAgents((items) => [...items.filter((item) => item.id !== created.id), created]);
      setDialogOpen(false); setDraft(emptyDraft); selectAgent(created.id, [created]);
      void reloadAgents();
    } catch {
      toast({ type: "error", message: t("multiAgent.planFailed") });
    } finally { setCreating(false); }
  }

  async function executeTask(target: MultiAgentTask) {
    const requestId = crypto.randomUUID();
    setRunRequestId(requestId);
    const unsubscribe = window.ohmycode.multiAgents.onEvent(requestId, (event) => {
      if (event.type === "task.updated") setTask(event.task);
      if (event.type === "node.event") {
        setNodeActivities((current) => ({
          ...current,
          [event.nodeId]: updateActivity(current[event.nodeId] ?? [], event.event),
        }));
      }
    });
    try {
      setTask(await window.ohmycode.multiAgents.runTask(target.id, requestId));
      await reloadAgents();
    } catch {
      toast({ type: "error", message: t("multiAgent.runFailed") });
      setTask(await window.ohmycode.multiAgents.getTask(target.id));
    } finally { unsubscribe(); setRunRequestId(null); }
  }

  async function runCollaboration(agentId: string, request: string, workspacePath: string) {
    const created = await window.ohmycode.multiAgents.createTask(agentId, request, workspacePath);
    resetRunDialog(); setNodeActivities({});
    await reloadAgents();
    setSelectedAgentId(agentId); setSelectedTaskId(created.id); setTask(created);
    await executeTask(created);
  }

  async function rerunTask(target: MultiAgentTask) {
    setNodeActivities({});
    setSelectedAgentId(target.agentId); setSelectedTaskId(target.id); setTask(target);
    await executeTask(target);
  }

  async function stopCurrentTask() {
    if (!task) return;
    await window.ohmycode.multiAgents.stopTask(runRequestId, task.id);
    setTask(await window.ohmycode.multiAgents.getTask(task.id));
  }

  async function confirmDelete() {
    const target = deleteTarget;
    if (!target) return;
    setDeleteTarget(null);
    try {
      if (target.type === "agent") {
        await window.ohmycode.multiAgents.delete(target.id);
        if (target.id === selectedAgentId) { setSelectedAgentId(null); setSelectedTaskId(null); setSelectedNodeId(null); setTask(null); }
        await reloadAgents();
      } else if (target.type === "task") {
        await window.ohmycode.multiAgents.deleteTask(target.id);
        if (target.id === selectedTaskId) { setSelectedTaskId(null); setTask(null); }
        await reloadAgents();
      } else if (task && target.type === "nodes") {
        commitCanvas({ ...task, nodes: task.nodes.filter((node) => !target.ids.includes(node.id)), edges: task.edges.filter((edge) => !target.ids.includes(edge.source) && !target.ids.includes(edge.target)) });
      } else if (task && target.type === "edges") {
        commitCanvas({ ...task, edges: task.edges.filter((edge) => !target.ids.includes(edge.id)) });
      }
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      toast({ type: "error", message: code.includes("workflow_running_cannot_delete") ? t("multiAgent.stopBeforeDelete") : t("multiAgent.deleteFailed") });
    }
  }

  function updateTemplateNode(field: "name" | "role" | "instructions" | "modelId", value: string) {
    if (!task || !selectedNodeId) return;
    setTask({
      ...task,
      nodes: task.nodes.map((node) => node.id === selectedNodeId
        ? { ...node, [field]: field === "modelId" ? value || null : value }
        : node),
    });
  }

  async function saveTemplate() {
    if (!selectedAgent || !task) return;
    const flow: MultiAgentTemplateFlow = {
      title: task.title,
      nodes: task.nodes.map((node) => ({
        key: node.key, name: node.name, role: node.role, instructions: node.instructions,
        modelId: node.modelId, position: positions[node.id] ?? node.position,
      })),
      edges: task.edges.map((edge) => ({ source: edge.source, target: edge.target })),
    };
    const updated = await window.ohmycode.multiAgents.update(
      selectedAgent.id,
      { templateFlow: flow } as Partial<MultiAgentSummary>,
    );
    setAgents((items) => items.map((item) => item.id === updated.id ? updated : item));
    setTask(templateAsTask(updated));
    toast({ type: "success", message: t("multiAgent.saved") });
  }

  function addTemplateNode() {
    if (!task) return;
    const key = `agent_${crypto.randomUUID().slice(0, 8)}`;
    commitCanvas({
      ...task,
      nodes: [...task.nodes, {
        id: key, key, name: t("multiAgent.newAgentNode"), role: t("multiAgent.newAgentRole"),
        instructions: "", status: "template", position: { x: 120, y: 120 },
        messages: [], changedFiles: [],
      }],
    });
    setSelectedNodeId(key);
  }

  function connectNodes(source: string, target: string) {
    if (!task) return;
    if (source === target || target === START_KEY || source === END_KEY || task.edges.some((edge) => edge.source === source && edge.target === target)) {
      toast({ type: "error", message: t("multiAgent.invalidConnection") }); return;
    }
    const graph = new Map<string, string[]>();
    for (const edge of task.edges) graph.set(edge.source, [...(graph.get(edge.source) ?? []), edge.target]);
    const pending = [target]; const visited = new Set<string>();
    while (pending.length) {
      const node = pending.pop()!;
      if (node === source) { toast({ type: "error", message: t("multiAgent.cycleNotAllowed") }); return; }
      if (visited.has(node)) continue;
      visited.add(node); pending.push(...(graph.get(node) ?? []));
    }
    commitCanvas({ ...task, edges: [...task.edges, { id: crypto.randomUUID(), source, target }] });
  }

  function selectCanvasNode(nodeId: string) {
    const node = task?.nodes.find((item) => item.id === nodeId);
    if (!node || node.key === END_KEY || (isTemplate && node.key === START_KEY)) { setSelectedNodeId(null); return; }
    setSelectedNodeId(nodeId);
  }

  async function sendAdjustment(nodeId: string) {
    if (!task || !adjustment.trim()) return;
    const content = adjustment.trim(); const requestId = crypto.randomUUID();
    setAdjustment(""); setAdjusting(true);
    setNodeActivities((current) => ({ ...current, [nodeId]: [
      ...(current[nodeId] ?? []).map((step) => step.status === "running" ? { ...step, status: "completed" as const } : step),
      { id: `run-pending-${requestId}`, type: "run", status: "running" },
      { id: `user-${requestId}`, type: "message", content: `${t("multiAgent.userAdjustment")}: ${content}`, status: "completed" },
    ] }));
    const unsubscribe = window.ohmycode.multiAgents.onEvent(requestId, (event) => {
      if (event.type === "task.updated") setTask(event.task);
      if (event.type === "node.event") setNodeActivities((current) => ({ ...current, [event.nodeId]: updateActivity(current[event.nodeId] ?? [], event.event) }));
    });
    try { setTask(await window.ohmycode.multiAgents.adjustNode(task.id, nodeId, content, requestId)); }
    catch { toast({ type: "error", message: t("multiAgent.adjustFailed") }); }
    finally { unsubscribe(); setAdjusting(false); }
  }

  return <AppShell navigation={<NavigationRail />} sidebar={<MultiAgentSidebar
    agents={agents} selectedAgentId={selectedAgentId} selectedTaskId={selectedTaskId}
    busy={creating} onCreateAgent={() => setDialogOpen(true)} onSelectAgent={selectAgent}
    onRunAgent={(agentId) => { setSelectedAgentId(agentId); setRunDialogOpen(true); }}
    onSelectTask={(taskId) => { setSelectedTaskId(taskId); setSelectedNodeId(null); }}
    onDeleteAgent={(agentId) => setDeleteTarget({ type: "agent", id: agentId })}
    onDeleteTask={(taskId) => setDeleteTarget({ type: "task", id: taskId })}
  />}>
    <main className={styles.page}>
      {task ? <>
        <header className={styles.header}>
          <div><h1>{task.title}</h1><p>{task.request}</p></div>
        </header>
        <div className={styles.workspace}>
          <div className={styles.canvasPane}><div className={styles.canvasActions}>
            {isTemplate && <button disabled={!undoStack.length} onClick={undoCanvas} aria-label={t("multiAgent.undo")}><Undo2 /></button>}
            {isTemplate && <button disabled={!redoStack.length} onClick={redoCanvas} aria-label={t("multiAgent.redo")}><Redo2 /></button>}
            {isTemplate && <button onClick={addTemplateNode}><Plus />{t("multiAgent.addNode")}</button>}
            {isTemplate && <button onClick={() => void saveTemplate()}><Save />{t("multiAgent.saveTemplate")}</button>}
            {!isTemplate && <button onClick={() => setActivityOpen(true)}><Activity />{t("multiAgent.activity")}</button>}
            {isTemplate
              ? <button className={styles.primary} onClick={() => setRunDialogOpen(true)}><Play />{t("multiAgent.run")}</button>
              : runRequestId || task.status === "running" ? <button className={styles.stop} onClick={() => void stopCurrentTask()}><Square />{t("multiAgent.stop")}</button>
                : task.status === "draft" ? <button className={styles.primary} onClick={() => void executeTask(task)}><Play />{t("multiAgent.start")}</button>
                  : ["stopped", "failed", "completed"].includes(task.status) ? <button className={styles.primary} onClick={() => void rerunTask(task)}><Play />{t("multiAgent.rerun")}</button> : null}
          </div>
          <WorkflowCanvas
            key={task.id}
            task={task}
            selectedNodeId={selectedNodeId}
            onNodeSelect={selectCanvasNode}
            onPositionsChange={(nextPositions) => {
              if (!task) return;
              commitCanvas({ ...task, nodes: task.nodes.map((node) => ({ ...node, position: nextPositions[node.id] ?? node.position })) });
            }}
            editable={isTemplate}
            onConnect={(connection) => {
              if (!connection.source || !connection.target) return;
              connectNodes(connection.source, connection.target);
            }}
            onDeleteNodes={(nodeIds) => { const ids = nodeIds.filter((id) => id !== START_KEY && id !== END_KEY); if (ids.length) setDeleteTarget({ type: "nodes", ids }); }}
            onDeleteEdges={(ids) => { if (ids.length) setDeleteTarget({ type: "edges", ids }); }}
          />
          </div>
          {selectedNode && <aside className={styles.detail}>
            <button className={styles.close} onClick={() => setSelectedNodeId(null)}><X /></button>
            {selectedNode.key !== START_KEY && <span className={styles.status}>{isTemplate ? t("multiAgent.agentNode") : t(`multiAgent.${selectedNode.status === "ready" ? "pending" : selectedNode.status}`, { defaultValue: selectedNode.status })}</span>}
            {isTemplate && selectedNode.key !== START_KEY && selectedNode.key !== END_KEY ? <>
              <label>{t("multiAgent.nodeName")}<input value={selectedNode.name} onChange={(event) => updateTemplateNode("name", event.target.value)} /></label>
              <label>{t("multiAgent.nodeRole")}<input value={selectedNode.role} onChange={(event) => updateTemplateNode("role", event.target.value)} /></label>
              <label>{t("multiAgent.nodeModel")}<select value={selectedNode.modelId ?? ""} onChange={(event) => updateTemplateNode("modelId", event.target.value)}><option value="">{t("multiAgent.defaultModel")}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.model}</option>)}</select></label>
              <label>{t("multiAgent.nodeInstructions")}<textarea value={selectedNode.instructions} onChange={(event) => updateTemplateNode("instructions", event.target.value)} /></label>
            </> : <>{selectedNode.key === START_KEY && !isTemplate ? <section className={styles.startRequirement}><h3>{t("multiAgent.runRequirement")}</h3><pre>{task.request}</pre></section> : <><h2>{selectedNode.name}</h2><p>{selectedNode.role}</p><section><h3>{t("multiAgent.nodeModel")}</h3><span>{models.find((model) => model.id === selectedNode.modelId)?.name ?? t("multiAgent.defaultModel")}</span></section><section><h3>{t("multiAgent.nodeInstructions")}</h3><pre>{selectedNode.instructions}</pre></section></>}</>}
          </aside>}
        </div>
      </> : <div className={styles.welcome}>
        <div className={styles.promptMark}>›_</div>
        <p className={styles.welcomeEyebrow}>{t("multiAgent.collaboration")}</p>
        <h1>{t("multiAgent.welcomeTitle")}</h1>
        <p className={styles.welcomeDescription}>{t("multiAgent.welcomeDescription")}</p>
      </div>}
      {dialogOpen && <div className={styles.backdrop} onMouseDown={() => !creating && setDialogOpen(false)}>
        <section className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>{t("multiAgent.collaboration")}</span><h2>{t("multiAgent.createCollaboration")}</h2></div><button onClick={() => setDialogOpen(false)}><X /></button></header>
          <label>{t("multiAgent.collaborationName")}<input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
          <label>{t("multiAgent.collaborationDescription")}<textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
          <label>{t("multiAgent.division")}<textarea value={draft.division} onChange={(event) => setDraft({ ...draft, division: event.target.value })} /></label>
          <footer><button onClick={() => setDialogOpen(false)}>{t("multiAgent.cancel")}</button><button className={styles.primary} disabled={creating || !draft.name.trim() || !draft.description.trim() || !draft.division.trim()} onClick={() => void createCollaboration()}>{creating && <LoaderCircle className={styles.spinner} />}{t("multiAgent.generateCollaboration")}</button></footer>
        </section>
      </div>}
      {runDialogOpen && selectedAgentId && <div className={styles.backdrop} onMouseDown={resetRunDialog}>
        <section className={styles.dialog} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>{t("multiAgent.run")}</span><h2>{t("multiAgent.runTaskTitle")}</h2></div><button onClick={resetRunDialog}><X /></button></header>
          <label>{t("multiAgent.runRequirement")}<textarea autoFocus value={runDescription} placeholder={t("multiAgent.runRequirementPlaceholder")} onChange={(event) => setRunDescription(event.target.value)} /></label>
          <label>{t("multiAgent.workspaceDirectory")}<button type="button" className={styles.directoryPicker} onClick={() => void window.ohmycode.multiAgents.selectWorkspace().then((value) => value && setRunWorkspacePath(value))}><FolderOpen /><span>{runWorkspacePath || t("multiAgent.chooseDirectory")}</span></button></label>
          <footer><button onClick={resetRunDialog}>{t("multiAgent.cancel")}</button><button className={styles.primary} disabled={!runDescription.trim() || !runWorkspacePath} onClick={() => void runCollaboration(selectedAgentId, runDescription, runWorkspacePath)}>{t("multiAgent.start")}</button></footer>
        </section>
      </div>}
      {activityOpen && task && <div className={styles.backdrop} onMouseDown={() => setActivityOpen(false)}>
        <section className={styles.activityDialog} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span>{t("multiAgent.liveActivity")}</span><h2>{task.title}</h2></div><div className={styles.activityHeaderActions}><div className={styles.viewSwitch}><button className={activityView === "agent" ? styles.activeView : ""} onClick={() => setActivityView("agent")}>{t("multiAgent.agentView")}</button><button className={activityView === "group" ? styles.activeView : ""} onClick={() => setActivityView("group")}>{t("multiAgent.groupChat")}</button></div><button className={styles.activityClose} onClick={() => setActivityOpen(false)}><X /></button></div></header>
          <div className={`${styles.activityBody} ${activityView === "group" ? styles.groupMode : ""}`}>
            {activityView === "agent" ? <><nav>{task.nodes.filter((node) => node.key !== START_KEY && node.key !== END_KEY).map((node) => <button className={activityNodeId === node.id ? styles.activeAgent : ""} key={node.id} onClick={() => setActivityNodeId(node.id)}><span className={styles[node.status === "ready" ? "pending" : node.status]} />{node.name}</button>)}</nav><div className={styles.activityContent}>{(() => { const node = task.nodes.find((item) => item.id === activityNodeId && item.key !== START_KEY && item.key !== END_KEY) ?? task.nodes.find((item) => item.key !== START_KEY && item.key !== END_KEY); if (!node) return null; const persisted = (node.finalOutput?.activity as AgentActivityStep[] | undefined) ?? []; const finalContent = typeof node.finalOutput?.content === "string" ? node.finalOutput.content : ""; const steps = withoutFinalResponse(nodeActivities[node.id] ?? persisted, finalContent); return <div className={styles.activityColumn}><div className={styles.nodeWorkspace}><div className={styles.activityScroll}><h3>{node.name}</h3><p>{node.role}</p>{steps.length ? <ActivityTimeline steps={steps} active={node.status === "running"} durationMs={node.agentDurationMs} startedAt={node.agentStartedAt ?? undefined} /> : !finalContent && <span>{t("multiAgent.waitingForActivity")}</span>}{finalContent && <div className={styles.finalOutput}><ReactMarkdown remarkPlugins={[remarkGfm]}>{finalContent}</ReactMarkdown></div>}</div><aside className={styles.nodeMessages}><h4>{t("multiAgent.receivedMessages")}</h4>{node.messages.length ? node.messages.map((message) => <article key={message.id}><header><strong>{message.senderType === "user" ? t("multiAgent.user") : task.nodes.find((item) => item.id === message.fromNodeId)?.name ?? t("multiAgent.unknownAgent")}</strong><time>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></header><p>{message.content}</p></article>) : <span>{t("multiAgent.noMessages")}</span>}</aside></div>{["running", "paused", "completed"].includes(node.status) && <div className={styles.adjustComposer}><MessageComposer value={adjustment} busy={adjusting} placeholder={t("multiAgent.adjustPlaceholder")} onChange={setAdjustment} onSubmit={() => void sendAdjustment(node.id)} /></div>}</div>; })()}</div></> : <div className={styles.groupChat}>{groupMessages.length ? groupMessages.map((message) => <article className={message.senderType === "user" ? styles.userChatMessage : styles.agentChatMessage} key={message.id}><div className={styles.chatMeta}><strong>{message.fromName}</strong><time>{new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(message.createdAt))}</time></div><div className={styles.chatBubble}><span>@{message.toName}</span><p>{message.content}</p></div></article>) : <div className={styles.emptyChat}>{t("multiAgent.noAgentMessages")}</div>}</div>}
          </div>
        </section>
      </div>}
      <ConfirmDialog open={Boolean(deleteTarget)} title={t("common.confirmDelete")} description={deleteTarget?.type === "task" && agents.flatMap((agent) => agent.tasks).find((item) => item.id === deleteTarget.id)?.status === "running" ? t("multiAgent.stopBeforeDelete") : t("common.deleteWarning")} onCancel={() => setDeleteTarget(null)} onConfirm={() => void confirmDelete()} />
    </main>
  </AppShell>;
}
