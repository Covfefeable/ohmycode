import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useFeedback } from "../../features/feedback";
import { updateActivity } from "../../features/conversation-chat/activity-timeline/updateActivity";
import { multiAgentErrorKey } from "./multi-agent-utils";

export type LiveAgentRun = {
  nodeId: string;
  detail: MultiAgentRunDetail;
};

type Options = {
  models: ModelConfiguration[];
  selectedAgentId: string | null;
  task: MultiAgentTask | null;
  setTask(task: MultiAgentTask | null): void;
  setSelectedTaskId(taskId: string | null): void;
  reloadAgents(): Promise<MultiAgentSummary[]>;
  reloadModels(): Promise<ModelConfiguration[]>;
};

function mentionedMembers(value: string, members: MultiAgentMemberData[]) {
  return members.filter((member) => {
    const escaped = member.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|\\s)@${escaped}(?=\\s|$|[.,，。])`).test(value);
  });
}

export function useMultiAgentExecution(options: Options) {
  const { t } = useTranslation();
  const { toast } = useFeedback();
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [runDescription, setRunDescription] = useState("");
  const [runWorkspacePath, setRunWorkspacePath] = useState("");
  const [runExecutionLimit, setRunExecutionLimit] = useState(20);
  const [runRequestId, setRunRequestId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [mentionTargetId, setMentionTargetId] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [liveAgentRuns, setLiveAgentRuns] = useState<Record<string, LiveAgentRun>>({});

  function hasValidMemberModels(target: MultiAgentTask, models: ModelConfiguration[]) {
    const configuredIds = new Set(models.map((model) => model.id));
    return target.members.every((member) => !member.modelId || configuredIds.has(member.modelId));
  }

  async function executeTask(target: MultiAgentTask) {
    let models = options.models;
    try {
      if (!models.length) models = await options.reloadModels();
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.loadFailed")) });
      return;
    }
    if (!models.length) {
      toast({ type: "error", message: t("multiAgent.modelRequired") });
      return;
    }
    if (!hasValidMemberModels(target, models)) {
      toast({ type: "error", message: t("multiAgent.memberModelMissing") });
      return;
    }
    const requestId = crypto.randomUUID();
    setLiveAgentRuns({});
    setRunRequestId(requestId);
    const unsubscribe = window.ohmycode.multiAgents.onEvent(requestId, (event) => {
      if (event.type === "task.updated") {
        options.setTask(event.task);
        setLiveAgentRuns((current) => {
          let changed = false;
          const now = new Date().toISOString();
          const next = Object.fromEntries(Object.entries(current).map(([nodeId, run]) => {
            const memberStillRunning = event.task.status === "running"
              && event.task.members.some((member) => member.id === nodeId && member.status === "running");
            if (run.detail.status !== "running" || memberStillRunning) return [nodeId, run];
            changed = true;
            return [nodeId, {
              ...run,
              detail: {
                ...run.detail,
                status: "completed",
                completedAt: now,
                durationMs: new Date(now).getTime() - new Date(run.detail.startedAt).getTime(),
              },
            }];
          }));
          return changed ? next : current;
        });
      }
      if (event.type === "node.event") {
        setLiveAgentRuns((current) => {
          const existing = current[event.nodeId];
          const startedAt = event.event.type === "turn.started"
            ? new Date().toISOString()
            : existing?.detail.startedAt ?? new Date().toISOString();
          const terminal = event.event.type === "turn.completed"
            || event.event.type === "turn.failed"
            || event.event.type === "turn.interrupted";
          const status = event.event.type === "turn.failed"
            ? "failed"
            : event.event.type === "turn.interrupted" ? "interrupted" : terminal ? "completed" : "running";
          const completedAt = terminal ? new Date().toISOString() : null;
          return {
            ...current,
            [event.nodeId]: {
              nodeId: event.nodeId,
              detail: {
                id: event.event.turnId,
                status,
                errorCode: event.event.type === "turn.failed" ? event.event.errorCode : null,
                startedAt,
                completedAt,
                durationMs: completedAt ? new Date(completedAt).getTime() - new Date(startedAt).getTime() : null,
                inputTokens: null,
                outputTokens: null,
                activity: updateActivity(event.event.type === "turn.started" ? [] : existing?.detail.activity ?? [], event.event),
              },
            },
          };
        });
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
    try {
      const models = options.models.length ? options.models : await options.reloadModels();
      if (!models.length) {
        toast({ type: "error", message: t("multiAgent.modelRequired") });
        return;
      }
      const created = await window.ohmycode.multiAgents.createTask(options.selectedAgentId, runDescription, runWorkspacePath, runExecutionLimit);
      setRunDialogOpen(false);
      setRunDescription("");
      setRunWorkspacePath("");
      options.setSelectedTaskId(created.id);
      options.setTask(created);
      setMentionTargetId(null);
      await options.reloadAgents();
      await executeTask(created);
    } catch (error) {
      toast({ type: "error", message: t(multiAgentErrorKey(error, "multiAgent.runFailed")) });
    }
  }

  async function sendGroupMessage() {
    if (!options.task || !message.trim()) return;
    const recipients = mentionedMembers(message, options.task.members);
    if (recipients.length > 1) {
      toast({ type: "error", message: t("multiAgent.singleRecipientOnly") });
      return;
    }
    const shouldResume = options.task.status === "waiting_user";
    const target = options.task.members.find((item) => item.id === mentionTargetId);
    const lastAskerId = [...options.task.messages].reverse().find(
      (item) => item.senderType === "agent" && item.toNodeId === null,
    )?.fromNodeId;
    const targetId = target?.id || lastAskerId || options.task.members.find((item) => item.isHost)?.id;
    if (!targetId) return;
    const escapedName = target?.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const content = target
      ? message.replace(new RegExp(`(?:^|\\s)@${escapedName}(?=\\s|$)`), " ").trim()
      : message.trim();
    if (!content) return;
    setSending(true);
    try {
      const updated = await window.ohmycode.multiAgents.sendMessage(options.task.id, targetId, content);
      options.setTask(updated);
      setMessage("");
      setMentionTargetId(null);
      if (shouldResume) await executeTask(updated);
    } catch {
      toast({ type: "error", message: t("multiAgent.adjustFailed") });
    } finally {
      setSending(false);
    }
  }

  function changeGroupMessage(value: string) {
    setMessage(value);
    const target = options.task ? mentionedMembers(value, options.task.members)[0] : undefined;
    setMentionTargetId(target?.id ?? null);
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
    runDialogOpen, runDescription, runWorkspacePath, runExecutionLimit, runRequestId,
    message, sending, liveAgentRuns, setRunDialogOpen, setRunDescription,
    setRunWorkspacePath, setRunExecutionLimit, executeTask, runCollaboration, sendGroupMessage,
    changeGroupMessage, stopTask,
  };
}
