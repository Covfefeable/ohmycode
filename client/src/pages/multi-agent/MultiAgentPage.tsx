import { useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, Play, Plus, Save, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { MultiAgentSidebar } from "../../features/multi-agent-sidebar";
import { WorkflowCanvas } from "../../features/workflow-canvas";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import styles from "./MultiAgentPage.module.css";

type CollaborationDraft = { name: string; description: string; division: string };
const emptyDraft: CollaborationDraft = { name: "", description: "", division: "" };

function templateAsTask(agent: MultiAgentSummary): MultiAgentTask {
  return {
    id: `template:${agent.id}`, agentId: agent.id, title: agent.name,
    request: agent.description, status: "template", workspacePath: "",
    nodes: agent.templateFlow.nodes.map((node) => ({
      ...node, id: node.key, status: "template", messages: [], changedFiles: [],
    })),
    edges: agent.templateFlow.edges.map((edge, index) => ({
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

  function selectAgent(agentId: string, source = agents) {
    const agent = source.find((item) => item.id === agentId);
    if (!agent) return;
    const template = templateAsTask(agent);
    setSelectedAgentId(agentId); setSelectedTaskId(null); setSelectedNodeId(null);
    setTask(template);
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
    });
    try {
      setTask(await window.ohmycode.multiAgents.runTask(target.id, requestId));
      await reloadAgents();
    } catch {
      toast({ type: "error", message: t("multiAgent.runFailed") });
      setTask(await window.ohmycode.multiAgents.getTask(target.id));
    } finally { unsubscribe(); setRunRequestId(null); }
  }

  async function runCollaboration(agentId: string) {
    const created = await window.ohmycode.multiAgents.createTask(agentId);
    if (!created) return;
    await reloadAgents();
    setSelectedAgentId(agentId); setSelectedTaskId(created.id); setTask(created);
    await executeTask(created);
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
    setTask({
      ...task,
      nodes: [...task.nodes, {
        id: key, key, name: t("multiAgent.newAgentNode"), role: t("multiAgent.newAgentRole"),
        instructions: "", status: "template", position: { x: 120, y: 120 },
        messages: [], changedFiles: [],
      }],
    });
    setSelectedNodeId(key);
  }

  return <AppShell navigation={<NavigationRail />} sidebar={<MultiAgentSidebar
    agents={agents} selectedAgentId={selectedAgentId} selectedTaskId={selectedTaskId}
    busy={creating} onCreateAgent={() => setDialogOpen(true)} onSelectAgent={selectAgent}
    onRunAgent={(agentId) => void runCollaboration(agentId)}
    onSelectTask={(taskId) => { setSelectedTaskId(taskId); setSelectedNodeId(null); }}
    onDeleteAgent={(agentId) => void window.ohmycode.multiAgents.delete(agentId).then(reloadAgents)}
    onDeleteTask={(taskId) => void window.ohmycode.multiAgents.deleteTask(taskId).then(async () => {
      if (taskId === selectedTaskId) setSelectedTaskId(null); await reloadAgents();
    })}
  />}>
    <main className={styles.page}>
      {task ? <>
        <header className={styles.header}>
          <div><h1>{task.title}</h1><p>{task.request}</p></div>
          {isTemplate && <button onClick={addTemplateNode}><Plus />{t("multiAgent.addNode")}</button>}
          {isTemplate && <button onClick={() => void saveTemplate()}><Save />{t("multiAgent.saveTemplate")}</button>}
          {isTemplate
            ? <button className={styles.primary} onClick={() => selectedAgentId && void runCollaboration(selectedAgentId)}><Play />{t("multiAgent.run")}</button>
            : runRequestId
              ? <button className={styles.stop} onClick={() => void window.ohmycode.multiAgents.stopTask(runRequestId)}><Square />{t("multiAgent.stop")}</button>
              : null}
        </header>
        <div className={styles.workspace}>
          <WorkflowCanvas
            key={`${task.id}:${task.updatedAt}`}
            task={task}
            selectedNodeId={selectedNodeId}
            onNodeSelect={setSelectedNodeId}
            onPositionsChange={setPositions}
            editable={isTemplate}
            onConnect={(connection) => {
              if (!connection.source || !connection.target) return;
              setTask((current) => current ? { ...current, edges: [...current.edges, { id: crypto.randomUUID(), source: connection.source, target: connection.target }] } : current);
            }}
            onDeleteNodes={(nodeIds) => setTask((current) => current ? { ...current, nodes: current.nodes.filter((node) => !nodeIds.includes(node.id)), edges: current.edges.filter((edge) => !nodeIds.includes(edge.source) && !nodeIds.includes(edge.target)) } : current)}
            onDeleteEdges={(edgeIds) => setTask((current) => current ? { ...current, edges: current.edges.filter((edge) => !edgeIds.includes(edge.id)) } : current)}
          />
          {selectedNode && <aside className={styles.detail}>
            <button className={styles.close} onClick={() => setSelectedNodeId(null)}><X /></button>
            <span className={styles.status}>{isTemplate ? t("multiAgent.agentNode") : t(`multiAgent.${selectedNode.status}`, { defaultValue: selectedNode.status })}</span>
            {isTemplate ? <>
              <label>{t("multiAgent.nodeName")}<input value={selectedNode.name} onChange={(event) => updateTemplateNode("name", event.target.value)} /></label>
              <label>{t("multiAgent.nodeRole")}<input value={selectedNode.role} onChange={(event) => updateTemplateNode("role", event.target.value)} /></label>
              <label>{t("multiAgent.nodeModel")}<select value={selectedNode.modelId ?? ""} onChange={(event) => updateTemplateNode("modelId", event.target.value)}><option value="">{t("multiAgent.defaultModel")}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.name} · {model.model}</option>)}</select></label>
              <label>{t("multiAgent.nodeInstructions")}<textarea value={selectedNode.instructions} onChange={(event) => updateTemplateNode("instructions", event.target.value)} /></label>
            </> : <>
              <h2>{selectedNode.name}</h2><p>{selectedNode.role}</p>
              <section><h3>{t("multiAgent.nodeInstructions")}</h3><pre>{selectedNode.instructions}</pre></section>
              <section><h3>{t("multiAgent.nodeMessages")}</h3>{selectedNode.messages.length ? selectedNode.messages.map((message) => <p key={message.id}>{message.content}</p>) : <span>{t("multiAgent.noMessages")}</span>}</section>
              <section><h3>{t("multiAgent.nodeFiles")}</h3>{selectedNode.changedFiles.length ? selectedNode.changedFiles.map((file) => <code key={file.id}>{file.operation} {file.path}</code>) : <span>{t("multiAgent.noFiles")}</span>}</section>
              {Boolean(selectedNode.finalOutput?.content) && <section><h3>{t("multiAgent.nodeOutput")}</h3><pre>{String(selectedNode.finalOutput?.content)}</pre></section>}
            </>}
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
    </main>
  </AppShell>;
}
