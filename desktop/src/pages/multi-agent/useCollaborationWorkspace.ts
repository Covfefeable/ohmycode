import { useCallback, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { emptyDraft, multiAgentErrorKey, type CollaborationDraft, type DeleteTarget } from "./multi-agent-utils";

const ACTIVE_AGENT_KEY = "ohmycode.activeCollaborationId";
const ACTIVE_TASK_KEY = "ohmycode.activeCollaborationTaskId";

export function useCollaborationWorkspace() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const location = useLocation();
  const [agents, setAgents] = useState<MultiAgentSummary[]>([]);
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(() => sessionStorage.getItem(ACTIVE_AGENT_KEY));
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => sessionStorage.getItem(ACTIVE_TASK_KEY));
  const [task, setTask] = useState<MultiAgentTask | null>(null);
  const [team, setTeam] = useState<MultiAgentTemplateTeam | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draft, setDraft] = useState<CollaborationDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const applyTaskSnapshot = useCallback((value: MultiAgentTask | null) => {
    setTask(value);
    if (!value) return;
    setTeam(null);
    setAgents((current) => current.map((agent) => {
      if (agent.id !== value.agentId) return agent;
      const summary: MultiAgentTaskSummary = {
        id: value.id,
        title: value.title,
        status: value.status,
        createdAt: value.createdAt,
      };
      const exists = agent.tasks.some((item) => item.id === value.id);
      return {
        ...agent,
        tasks: exists
          ? agent.tasks.map((item) => item.id === value.id ? summary : item)
          : [...agent.tasks, summary],
      };
    }));
  }, []);

  const reloadAgents = useCallback(async () => {
    const value = await window.ohmycode.multiAgents.list();
    setAgents(value);
    return value;
  }, []);

  const reloadModels = useCallback(async () => {
    const models = await window.ohmycode.settings.listModels();
    setModels(models);
    return models;
  }, []);

  useEffect(() => window.ohmycode.settings.onModelsChanged(setModels), []);

  useEffect(() => {
    if (selectedAgentId) sessionStorage.setItem(ACTIVE_AGENT_KEY, selectedAgentId);
    else sessionStorage.removeItem(ACTIVE_AGENT_KEY);
  }, [selectedAgentId]);

  useEffect(() => {
    if (selectedTaskId) sessionStorage.setItem(ACTIVE_TASK_KEY, selectedTaskId);
    else sessionStorage.removeItem(ACTIVE_TASK_KEY);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!location.pathname.startsWith("/agents")) return;
    let active = true;
    void window.ohmycode.multiAgents.list()
      .then((items) => {
        if (!active) return;
        setAgents(items);
        if (!sessionStorage.getItem(ACTIVE_TASK_KEY)) {
          const selected = items.find((item) => item.id === sessionStorage.getItem(ACTIVE_AGENT_KEY));
          if (selected) setTeam(selected.templateTeam);
        }
      })
      .catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
    void window.ohmycode.settings.listModels()
      .then((models) => { if (active) setModels(models); })
      .catch(() => toast({ type: "error", message: t("common.networkError") }));
    return () => { active = false; };
  }, [location.pathname, t, toast]);

  useEffect(() => {
    if (!selectedTaskId) return;
    let active = true;
    void window.ohmycode.multiAgents.getTask(selectedTaskId).then((value) => { if (active) applyTaskSnapshot(value); })
      .catch(() => toast({ type: "error", message: t("multiAgent.loadFailed") }));
    return () => { active = false; };
  }, [applyTaskSnapshot, selectedTaskId, t, toast]);

  const selectedAgent = agents.find((item) => item.id === selectedAgentId) ?? null;
  const selectedMember = task?.members.find((item) => item.id === selectedMemberId) ?? null;
  const selectedTemplateMember = team?.members.find((item) => item.key === selectedMemberId) ?? null;

  function selectAgent(agentId: string, source = agents) {
    const agent = source.find((item) => item.id === agentId);
    if (!agent) return;
    setSelectedAgentId(agentId);
    setSelectedTaskId(null);
    setSelectedMemberId(null);
    setTask(null);
    setTeam(agent.templateTeam);
  }

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId);
    setSelectedMemberId(null);
  }

  async function createCollaboration() {
    if (!draft.name.trim() || !draft.description.trim() || !draft.division.trim()) return;
    setCreating(true);
    try {
      const availableModels = models.length ? models : await reloadModels();
      if (!availableModels.length) {
        toast({ type: "error", message: t("multiAgent.modelRequired") });
        return;
      }
      const created = await window.ohmycode.multiAgents.create(draft);
      if (!created.templateTeam.members.length) throw new Error("empty_team");
      const source = [...agents.filter((item) => item.id !== created.id), created];
      setAgents(source);
      selectAgent(created.id, source);
      setCreateDialogOpen(false);
      setDraft(emptyDraft);
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.planFailed")) });
    } finally {
      setCreating(false);
    }
  }

  async function saveTeam() {
    if (!selectedAgent || !team) return;
    const updated = await window.ohmycode.multiAgents.update(selectedAgent.id, {
      templateTeam: team,
    });
    setAgents((items) => items.map((item) => item.id === updated.id ? updated : item));
    setTeam(updated.templateTeam);
    toast({ type: "success", message: t("multiAgent.saved") });
  }

  function updateMember(field: "name" | "role" | "instructions" | "modelId", value: string) {
    if (!team || !selectedMemberId) return;
    setTeam({
      ...team,
      members: team.members.map((member) => member.key === selectedMemberId
        ? { ...member, [field]: field === "modelId" ? value || null : value }
        : member),
    });
  }

  function addMember() {
    if (!team) return;
    const key = `agent_${crypto.randomUUID().slice(0, 8)}`;
    setTeam({
      ...team,
      members: [...team.members, {
        key,
        name: t("multiAgent.newAgentNode"),
        role: t("multiAgent.newAgentRole"),
        instructions: "",
        isHost: false,
        sortOrder: team.members.length,
      }],
    });
    setSelectedMemberId(key);
  }

  function removeMember(memberId: string) {
    if (!team) return;
    const member = team.members.find((item) => item.key === memberId);
    if (!member || member.isHost) return;
    setTeam({
      ...team,
      members: team.members
        .filter((item) => item.key !== memberId)
        .map((item, index) => ({ ...item, sortOrder: index })),
    });
    if (selectedMemberId === memberId) setSelectedMemberId(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    setDeleteTarget(null);
    try {
      if (target.type === "agent") {
        await window.ohmycode.multiAgents.delete(target.id);
        if (selectedAgentId === target.id) {
          setTask(null);
          setTeam(null);
          setSelectedAgentId(null);
          setSelectedTaskId(null);
        }
      } else {
        const wasSelected = selectedTaskId === target.id;
        if (wasSelected) {
          setTask(null);
          setSelectedTaskId(null);
          setSelectedMemberId(null);
        }
        await window.ohmycode.multiAgents.deleteTask(target.id);
      }
      await reloadAgents();
    } catch {
      toast({ type: "error", message: t("multiAgent.deleteFailed") });
    }
  }

  return {
    agents, models, selectedAgentId, selectedTaskId, task, team, selectedAgent, selectedMember, selectedTemplateMember, selectedMemberId,
    createDialogOpen, draft, creating, deleteTarget, reloadAgents, reloadModels, setSelectedAgentId,
    setSelectedTaskId, setTask: applyTaskSnapshot, setSelectedMemberId, setCreateDialogOpen, setDraft,
    setDeleteTarget, selectAgent, selectTask, createCollaboration, saveTeam, updateMember,
    addMember, removeMember, confirmDelete,
  };
}
