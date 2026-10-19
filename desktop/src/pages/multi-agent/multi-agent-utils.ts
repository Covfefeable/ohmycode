import { classifyRequestError, requestErrorDetails } from "../../shared/lib/request-error";

export type CollaborationDraft = { name: string; description: string; division: string };
export type DeleteTarget = { type: "agent" | "task"; id: string };
export const emptyDraft: CollaborationDraft = { name: "", description: "", division: "" };


export function multiAgentErrorKey(error: unknown, fallbackKey: string): string {
  if (requestErrorDetails(error)?.code === "workspace_not_found") return "multiAgent.workspaceNotFound";
  const kind = classifyRequestError(error);
  if (kind === "model_not_configured") return "multiAgent.modelRequired";
  if (kind === "network_error") return "common.networkError";
  return fallbackKey;
}
