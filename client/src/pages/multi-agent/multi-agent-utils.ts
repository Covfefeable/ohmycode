import { classifyRequestError } from "../../shared/lib/request-error";

export type CollaborationDraft = { name: string; description: string; division: string };
export type DeleteTarget = { type: "agent" | "task"; id: string };
export const emptyDraft: CollaborationDraft = { name: "", description: "", division: "" };

export function templateTask(agent: MultiAgentSummary): MultiAgentTask {
  return {
    id: `template:${agent.id}`,
    agentId: agent.id,
    title: agent.name,
    request: agent.description,
    status: "template",
    workspacePath: "",
    currentSpeakerId: null,
    messages: [],
    members: agent.templateTeam.members.map((member) => ({
      ...member,
      id: member.key,
      status: "idle",
      changedFiles: [],
    })),
    createdAt: agent.createdAt,
    updatedAt: agent.createdAt,
  };
}

export function multiAgentErrorKey(error: unknown, fallbackKey: string): string {
  const kind = classifyRequestError(error);
  if (kind === "model_not_configured") return "multiAgent.modelRequired";
  if (kind === "network_error") return "common.networkError";
  return fallbackKey;
}
