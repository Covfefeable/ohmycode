import path from "node:path";
import { realpath, stat } from "node:fs/promises";

export async function workspaceDirectory(projectId: string, workspaceRoot?: string): Promise<string> {
  if (workspaceRoot) return path.resolve(workspaceRoot);
  const { listProjects } = await import("../projects/projects-service.js");
  const project = (await listProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("project_not_found");
  return path.resolve(project.path);
}

export function assertInside(root: string, target: string): void {
  const relative = path.relative(root, target);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("path_outside_workspace");
}

export async function safeExistingPath(root: string, requested = "."): Promise<string> {
  const resolvedRoot = await realpath(root);
  const target = await realpath(path.resolve(root, requested));
  assertInside(resolvedRoot, target);
  return target;
}

export async function safeNewPath(root: string, requested: string): Promise<string> {
  const resolvedRoot = await realpath(root);
  const target = path.resolve(root, requested);
  assertInside(resolvedRoot, target);
  let ancestor = path.dirname(target);
  while (ancestor !== path.dirname(ancestor)) {
    try {
      await stat(ancestor);
      const resolvedAncestor = await realpath(ancestor);
      assertInside(resolvedRoot, resolvedAncestor);
      return target;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      ancestor = path.dirname(ancestor);
    }
  }
  throw new Error("path_outside_workspace");
}
