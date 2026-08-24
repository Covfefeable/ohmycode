import path from "node:path";
import { dialog, shell } from "electron";
import { ApiError, apiRequest } from "../api/api-client.js";
import type { LocalConversation, LocalProject } from "./types.js";

const normalizedPath = (value: string) => path.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase();

export function listProjects(): Promise<LocalProject[]> { return apiRequest("/api/projects"); }

export async function createProject() {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled) return { ok: false as const, reason: "canceled" as const };
  const selectedPath = path.resolve(result.filePaths[0]);
  if ((await listProjects()).some((project) => normalizedPath(project.path) === normalizedPath(selectedPath))) {
    return { ok: false as const, reason: "exists" as const };
  }
  try {
    const project = await apiRequest<LocalProject>("/api/projects", { method: "POST", body: JSON.stringify({ name: path.basename(selectedPath), path: selectedPath }) });
    return { ok: true as const, project };
  } catch (error) {
    if (error instanceof ApiError && error.code === "project_exists") return { ok: false as const, reason: "exists" as const };
    throw error;
  }
}

export async function openProject(projectId: string): Promise<void> {
  const project = (await listProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  const error = await shell.openPath(project.path);
  if (error) throw new Error(error);
}

export function deleteProject(projectId: string): Promise<void> { return apiRequest(`/api/projects/${projectId}`, { method: "DELETE" }); }
export function createConversation(projectId: string, title: string): Promise<LocalConversation> { return apiRequest(`/api/projects/${projectId}/conversations`, { method: "POST", body: JSON.stringify({ title }) }); }
export function deleteConversation(_projectId: string, conversationId: string): Promise<void> { return apiRequest(`/api/projects/conversations/${conversationId}`, { method: "DELETE" }); }
export function getConversation(conversationId: string): Promise<LocalConversation> { return apiRequest(`/api/projects/conversations/${conversationId}`); }
