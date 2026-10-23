import path from "node:path";
import { shell } from "electron";
import { listProjects } from "../projects/projects-service.js";
import { safeExistingPath } from "./workspace.js";

export async function openLocalPath(targetPath: string, projectId?: string): Promise<void> {
  if (!targetPath.trim()) throw new Error("path_required");
  let resolvedPath = targetPath;
  if (!path.isAbsolute(targetPath)) {
    const project = (await listProjects()).find((item) => item.id === projectId);
    if (!project) throw new Error("project_not_found");
    resolvedPath = await safeExistingPath(project.path, targetPath);
  }
  const error = await shell.openPath(resolvedPath);
  if (error) throw new Error(error);
}
