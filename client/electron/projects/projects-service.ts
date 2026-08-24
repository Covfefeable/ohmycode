import path from "node:path";
import { randomUUID } from "node:crypto";
import { dialog, shell } from "electron";
import { readProjects, writeProjects } from "./projects-store.js";

const normalizedPath = (value: string) => path.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase();

export async function listProjects() {
  return (await readProjects()).projects;
}

export async function createProject() {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (result.canceled) return { ok: false as const, reason: "canceled" as const };
  const selectedPath = path.resolve(result.filePaths[0]);
  const data = await readProjects();
  if (data.projects.some((project) => normalizedPath(project.path) === normalizedPath(selectedPath))) {
    return { ok: false as const, reason: "exists" as const };
  }
  const project = { id: randomUUID(), name: path.basename(selectedPath), path: selectedPath, conversations: [] };
  data.projects.push(project);
  await writeProjects(data);
  return { ok: true as const, project };
}

export async function openProject(projectId: string): Promise<void> {
  const project = (await readProjects()).projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  const error = await shell.openPath(project.path);
  if (error) throw new Error(error);
}

export async function deleteProject(projectId: string): Promise<void> {
  const data = await readProjects();
  data.projects = data.projects.filter((project) => project.id !== projectId);
  await writeProjects(data);
}

export async function createConversation(projectId: string, title: string) {
  const data = await readProjects();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  const conversation = {
    id: randomUUID(),
    title: `${title.trim().slice(0, 80) || "New conversation"} ${project.conversations.length + 1}`,
    createdAt: new Date().toISOString(),
  };
  project.conversations.push(conversation);
  await writeProjects(data);
  return conversation;
}

export async function deleteConversation(projectId: string, conversationId: string): Promise<void> {
  const data = await readProjects();
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) throw new Error("Project not found");
  project.conversations = project.conversations.filter((item) => item.id !== conversationId);
  await writeProjects(data);
}
