import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { updateActivity } from "../../features/conversation-chat/activity-timeline/updateActivity";
import { multiAgentErrorKey } from "./multi-agent-utils";

type Options = {
  models: ModelConfiguration[];
  selectedAgentId: string | null;
  task: MultiAgentTask | null;
  setTask(task: MultiAgentTask | null): void;
  setSelectedTaskId(taskId: string | null): void;
  reloadAgents(): Promise<MultiAgentSummary[]>;
};

export function useMultiAgentExecution(options: Options) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runDescription, setRunDescription] = useState("");
  const [runWorkspacePath, setRunWorkspacePath] = useState("");
  const [runRequestId, setRunRequestId] = useState<string | null>(null);
  const [activities, setActivities] = useState<Record<string, AgentActivityStep[]>>({});
  const [message, setMessage] = useState("");
  const [mentionTargetId, setMentionTargetId] = useState<string | null>(null);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const mentionMembers = useMemo(() => {
    if (!options.task || mentionQuery === null) return [];
    const query = mentionQuery.trim().toLocaleLowerCase();
    return options.task.members.filter((member) => !query || member.name.toLocaleLowerCase().includes(query));
  }, [mentionQuery, options.task]);

  function hasValidMemberModels(target: MultiAgentTask) {
    const configuredIds = new Set(options.models.map((model) => model.id));
    return target.members.every((member) => !member.modelId || configuredIds.has(member.modelId));
  }

  async function executeTask(target: MultiAgentTask) {
    if (!options.models.length) {
      toast({ type: "error", message: t("multiAgent.modelRequired") });
      return;
    }
    if (!hasValidMemberModels(target)) {
      toast({ type: "error", message: t("multiAgent.memberModelMissing") });
      return;
    }
    if (["completed", "failed", "stopped"].includes(target.status)) {
      setActivities({});
    }
    const requestId = crypto.randomUUID();
    setRunRequestId(requestId);
    const unsubscribe = window.ohmycode.multiAgents.onEvent(requestId, (event) => {
      if (event.type === "task.updated") options.setTask(event.task);
      if (event.type === "node.event") {
        setActivities((current) => ({
          ...current,
          [event.nodeId]: updateActivity(current[event.nodeId] ?? [], event.event),
        }));
      }
    });
    try {
      options.setTask(await window.ohmycode.multiAgents.runTask(target.id, requestId));
      await options.reloadAgents();
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.runFailed")) });
      options.setTask(await window.ohmycode.multiAgents.getTask(target.id));
    } finally {
      unsubscribe();
      setRunRequestId(null);
      await options.reloadAgents();
    }
  }

  async function runCollaboration() {
    if (!options.selectedAgentId || !runDescription.trim() || !runWorkspacePath) return;
    if (!options.models.length) {
      toast({ type: "error", message: t("multiAgent.modelRequired") });
      return;
    }
    try {
      const created = await window.ohmycode.multiAgents.createTask(options.selectedAgentId, runDescription, runWorkspacePath);
      setRunDialogOpen(false);
      setRunDescription("");
      setRunWorkspacePath("");
      setActivities({});
      options.setSelectedTaskId(created.id);
      options.setTask(created);
      setMentionTargetId(null);
      setMentionQuery(null);
      await options.reloadAgents();
      await executeTask(created);
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.runFailed")) });
    }
  }

  async function sendGroupMessage() {
    if (!options.task || !message.trim()) return;
    const target = options.task.members.find((item) => item.id === mentionTargetId);
    const targetId = target?.id || options.task.members.find((item) => item.isHost)?.id;
    if (!targetId) return;
    const escapedName = target?.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const content = target
      ? message.replace(new RegExp(`^@${escapedName}\\s*`), "").trim()
      : message.trim();
    if (!content) return;
    setSending(true);
    try {
      options.setTask(await window.ohmycode.multiAgents.sendMessage(options.task.id, targetId, content));
      setMessage("");
      setMentionTargetId(null);
      setMentionQuery(null);
    } catch {
      toast({ type: "error", message: t("multiAgent.adjustFailed") });
    } finally {
      setSending(false);
    }
  }

  function changeGroupMessage(value: string) {
    setMessage(value);
    if (mentionTargetId) {
      const target = options.task?.members.find((item) => item.id === mentionTargetId);
      if (!target || !value.startsWith(`@${target.name}`)) setMentionTargetId(null);
    }
    const match = value.match(/(?:^|\s)@([^\s@]*)$/);
    setMentionQuery(match ? match[1] : null);
  }

  function selectMention(member: MultiAgentMemberData) {
    const selectedTarget = options.task?.members.find((item) => item.id === mentionTargetId);
    const escapedName = selectedTarget?.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const withoutSelected = selectedTarget
      ? message.replace(new RegExp(`^@${escapedName}\\s*`), "")
      : message;
    const next = withoutSelected.replace(/(?:^|\s)@[^\s@]*$/, "").trimStart();
    setMessage(`@${member.name} ${next}`);
    setMentionTargetId(member.id);
    setMentionQuery(null);
  }

  function closeMention() {
    setMentionQuery(null);
  }

  async function stopTask() {
    if (!options.task) return;
    try {
      await window.ohmycode.multiAgents.stopTask(runRequestId, options.task.id);
      const stopped = await window.ohmycode.multiAgents.getTask(options.task.id);
      options.setTask(stopped);
      setRunRequestId(null);
      await options.reloadAgents();
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.stopFailed")) });
    }
  }

  return {
    runDialogOpen, runDescription, runWorkspacePath, runRequestId, activities,
    message, mentionQuery, mentionMembers, sending, setRunDialogOpen, setRunDescription,
    setRunWorkspacePath, executeTask, runCollaboration, sendGroupMessage,
    changeGroupMessage, selectMention, closeMention, stopTask,
  };
}
