import { useCallback, useEffect, useMemo, useState } from "react";
import { Play, Save, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MultiAgentSidebar } from "../../features/multi-agent-sidebar";
import { useFeedback } from "../../features/feedback";
import { WorkflowCanvas } from "../../features/workflow-canvas";
import { AppShell } from "../../shared/layout/app-shell";
import { NavigationRail } from "../../widgets/navigation-rail";
import styles from "./MultiAgentPage.module.css";

export function MultiAgentPage() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [agents, setAgents] = useState<MultiAgentSummary[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<MultiAgentTask | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [draftRequest, setDraftRequest] = useState("");
  const [creatingTask, setCreatingTask] = useState(false);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [runRequestId, setRunRequestId] = useState<string | null>(null);

  const reloadAgents = useCallback(async () => setAgents(await window.ohmycode.multiAgents.list()), []);
  useEffect(() => {
    void window.ohmycode.multiAgents.list().then(setAgents).catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
  }, [t, toast]);
  useEffect(() => {
    if (!selectedTaskId) return;
    void window.ohmycode.multiAgents.getTask(selectedTaskId).then((value) => {
      setTask(value);
      setPositions(Object.fromEntries(value.nodes.map((node) => [node.id, node.position])));
    }).catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
  }, [selectedTaskId, t, toast]);

  const selectedNode = useMemo(() => task?.nodes.find((node) => node.id === selectedNodeId) ?? null, [task, selectedNodeId]);

  async function createAgent() {
    const created = await window.ohmycode.multiAgents.create();
    if (!created) return;
    await reloadAgents();
    setSelectedAgentId(created.id);
    setCreatingTask(true);
    setSelectedTaskId(null);
  }

  async function planTask() {
    if (!selectedAgentId || !draftRequest.trim()) return;
    setPlanning(true);
    try {
      const created = await window.ohmycode.multiAgents.planTask(selectedAgentId, draftRequest.trim());
      await reloadAgents();
      setTask(created);
      setSelectedTaskId(created.id);
      setCreatingTask(false);
      setDraftRequest("");
    } catch {
      toast({ type: "error", message: t("multiAgent.planFailed") });
    } finally { setPlanning(false); }
  }

  async function saveLayout() {
    if (!task) return;
    const updated = await window.ohmycode.multiAgents.saveFlow(task.id, positions);
    setTask(updated);
    toast({ type: "success", message: t("multiAgent.saved") });
  }

  async function runTask() {
    if (!task || runRequestId) return;
    const requestId = crypto.randomUUID();
    setRunRequestId(requestId);
    const unsubscribe = window.ohmycode.multiAgents.onEvent(requestId, (event) => {
      if (event.type === "task.updated") setTask(event.task);
    });
    try {
      const completed = await window.ohmycode.multiAgents.runTask(task.id, requestId);
      setTask(completed);
      await reloadAgents();
    } catch {
      toast({ type: "error", message: t("multiAgent.runFailed") });
      setTask(await window.ohmycode.multiAgents.getTask(task.id));
    } finally {
      unsubscribe();
      setRunRequestId(null);
    }
  }

  async function stopTask() {
    if (!runRequestId) return;
    await window.ohmycode.multiAgents.stopTask(runRequestId);
  }

  return <AppShell
    navigation={<NavigationRail />}
    sidebar={<MultiAgentSidebar
      agents={agents}
      selectedTaskId={selectedTaskId}
      busy={planning}
      onCreateAgent={() => void createAgent()}
      onCreateTask={(agentId) => { setSelectedAgentId(agentId); setSelectedTaskId(null); setCreatingTask(true); }}
      onSelectTask={(taskId) => { setSelectedTaskId(taskId); setCreatingTask(false); setSelectedNodeId(null); }}
      onDeleteAgent={(agentId) => void window.ohmycode.multiAgents.delete(agentId).then(reloadAgents)}
      onDeleteTask={(taskId) => void window.ohmycode.multiAgents.deleteTask(taskId).then(async () => { if (taskId === selectedTaskId) setSelectedTaskId(null); await reloadAgents(); })}
    />}
  >
    <main className={styles.page}>
      {creatingTask ? <section className={styles.planner}>
        <div><p>{t("multiAgent.taskRequest")}</p><h1>{t("multiAgent.newTask")}</h1></div>
        <textarea autoFocus value={draftRequest} placeholder={t("multiAgent.taskPlaceholder")} onChange={(event) => setDraftRequest(event.target.value)} />
        <button disabled={planning || !draftRequest.trim()} onClick={() => void planTask()}>{planning ? t("multiAgent.planning") : t("multiAgent.generateFlow")}</button>
      </section> : task ? <>
        <header className={styles.header}>
          <div><h1>{task.title}</h1><p>{task.request}</p></div>
          <button onClick={() => void saveLayout()}><Save />{t("multiAgent.saveLayout")}</button>
          {runRequestId
            ? <button className={styles.stop} onClick={() => void stopTask()}><Square />{t("multiAgent.stop")}</button>
            : <button className={styles.primary} disabled={!(["draft", "failed", "stopped"].includes(task.status))} onClick={() => void runTask()}><Play />{t("multiAgent.start")}</button>}
        </header>
        <div className={styles.workspace}>
          <WorkflowCanvas key={task.updatedAt} task={task} selectedNodeId={selectedNodeId} onNodeSelect={setSelectedNodeId} onPositionsChange={setPositions} />
          {selectedNode && <aside className={styles.detail}>
            <button className={styles.close} onClick={() => setSelectedNodeId(null)}><X /></button>
            <span className={styles.status}>{t(`multiAgent.${selectedNode.status}`, { defaultValue: selectedNode.status })}</span>
            <h2>{selectedNode.name}</h2>
            <p>{selectedNode.role}</p>
            <section><h3>{t("multiAgent.nodeInstructions")}</h3><pre>{selectedNode.instructions}</pre></section>
            <section><h3>{t("multiAgent.nodeMessages")}</h3>{selectedNode.messages.length ? selectedNode.messages.map((message) => <p key={message.id}>{message.content}</p>) : <span>{t("multiAgent.noMessages")}</span>}</section>
            <section><h3>{t("multiAgent.nodeFiles")}</h3>{selectedNode.changedFiles.length ? selectedNode.changedFiles.map((file) => <code key={file.id}>{file.operation} {file.path}</code>) : <span>{t("multiAgent.noFiles")}</span>}</section>
            {Boolean(selectedNode.finalOutput?.content) && <section><h3>{t("multiAgent.nodeOutput")}</h3><pre>{String(selectedNode.finalOutput?.content)}</pre></section>}
          </aside>}
        </div>
      </> : <div className={styles.empty}>{t("multiAgent.selectTask")}</div>}
    </main>
  </AppShell>;
}
