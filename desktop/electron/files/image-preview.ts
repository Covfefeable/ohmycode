import path from "node:path";
import { executeViewImage } from "./image-tool.js";
import { listProjects } from "../projects/projects-service.js";
import { getMultiAgentTask } from "../multi-agents/multi-agent-service.js";
import { previewImageAsset } from "./image-assets.js";

import type { ImageScope } from "../../contracts/domain.js";

export async function previewWorkspaceImage(scope: ImageScope | undefined, reference: string): Promise<string> {
  if (reference.startsWith("ohmycode-image://")) return previewImageAsset(reference);
  if (/^https?:\/\//i.test(reference)) throw new Error("local_image_required");
  if (path.isAbsolute(reference) || /^file:/i.test(reference)) {
    return (await executeViewImage({ projectId: "", imageUrl: reference })).dataUrl;
  }
  if (!scope) throw new Error("workspace_required");
  const workspace = "conversationId" in scope
    ? (await listProjects()).find((project) => project.conversations.some((conversation) => conversation.id === scope.conversationId))?.path
    : (await getMultiAgentTask(scope.taskId)).workspacePath;
  if (!workspace) throw new Error("workspace_not_found");
  const image = await executeViewImage({ projectId: "", imageUrl: reference }, workspace);
  return image.dataUrl;
}
