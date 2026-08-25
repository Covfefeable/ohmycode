import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { emptyDraft, multiAgentErrorKey, templateTask, type CollaborationDraft, type DeleteTarget } from "./multi-agent-utils";

export function useCollaborationWorkspace() {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [agents, setAgents] = useState<MultiAgentSummary[]>([]);
  const [models, setModels] = useState<ModelConfiguration[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [task, setTask] = useState<MultiAgentTask | null>(null);
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [draft, setDraft] = useState<CollaborationDraft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

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

  const selectedAgent = agents.find((item) => item.id === selectedAgentId) ?? null;
  const selectedMember = task?.members.find((item) => item.id === selectedMemberId) ?? null;

  function selectAgent(agentId: string, source = agents) {
    const agent = source.find((item) => item.id === agentId);
    if (!agent) return;
    setSelectedAgentId(agentId);
    setSelectedTaskId(null);
    setSelectedMemberId(null);
    setTask(templateTask(agent));
  }

  function selectTask(taskId: string) {
    setSelectedTaskId(taskId);
    setSelectedMemberId(null);
  }

  async function createCollaboration() {
    if (!draft.name.trim() || !draft.description.trim() || !draft.division.trim()) return;
    if (!models.length) {
      toast({ type: "error", message: t("multiAgent.modelRequired") });
      return;
    }
    setCreating(true);
    try {
      const created = await window.ohmycode.multiAgents.create(draft);
      if (!created.templateTeam.members.length) throw new Error("empty_team");
      const source = [...agents.filter((item) => item.id !== created.id), created];
      setAgents(source);
      selectAgent(created.id, source);
      setCreateDialogOpen(false);
      setDraft(emptyDraft);
      void reloadAgents();
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.planFailed")) });
    } finally {
      setCreating(false);
    }
  }

  async function saveTeam() {
    if (!selectedAgent || !task) return;
    const updated = await window.ohmycode.multiAgents.update(selectedAgent.id, {
      templateTeam: {
        title: task.title,
        members: task.members.map(({ key, name, role, instructions, modelId, isHost, sortOrder }) => ({ key, name, role, instructions, modelId, isHost, sortOrder })),
      },
    } as Partial<MultiAgentSummary>);
    setAgents((items) => items.map((item) => item.id === updated.id ? updated : item));
    setTask(templateTask(updated));
    toast({ type: "success", message: t("multiAgent.saved") });
  }

  function updateMember(field: "name" | "role" | "instructions" | "modelId", value: string) {
    if (!task || !selectedMemberId) return;
    setTask({
      ...task,
      members: task.members.map((member) => member.id === selectedMemberId
        ? { ...member, [field]: field === "modelId" ? value || null : value }
        : member),
    });
  }

  function addMember() {
    if (!task) return;
    const key = `agent_${crypto.randomUUID().slice(0, 8)}`;
    setTask({
      ...task,
      members: [...task.members, {
        id: key,
        key,
        name: t("multiAgent.newAgentNode"),
        role: t("multiAgent.newAgentRole"),
        instructions: "",
        isHost: false,
        sortOrder: task.members.length,
        status: "idle",
        changedFiles: [],
      }],
    });
    setSelectedMemberId(key);
  }

  function removeMember(memberId: string) {
    if (!task) return;
    const member = task.members.find((item) => item.id === memberId);
    if (!member || member.isHost) return;
    setTask({
      ...task,
      members: task.members
        .filter((item) => item.id !== memberId)
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
          setSelectedAgentId(null);
          setSelectedTaskId(null);
        }
      } else {
        await window.ohmycode.multiAgents.deleteTask(target.id);
        if (selectedTaskId === target.id) {
          setTask(null);
          setSelectedTaskId(null);
        }
      }
      await reloadAgents();
    } catch {
      toast({ type: "error", message: t("multiAgent.deleteFailed") });
    }
  }

  return {
    agents, models, selectedAgentId, selectedTaskId, task, selectedMember, selectedMemberId,
    createDialogOpen, draft, creating, deleteTarget, reloadAgents, setSelectedAgentId,
    setSelectedTaskId, setTask, setSelectedMemberId, setCreateDialogOpen, setDraft,
    setDeleteTarget, selectAgent, selectTask, createCollaboration, saveTeam, updateMember,
    addMember, removeMember, confirmDelete,
  };
}
