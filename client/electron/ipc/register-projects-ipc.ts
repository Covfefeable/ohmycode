import { ipcMain } from "electron";
import {
  createConversation,
  createProject,
  deleteConversation,
  deleteProject,
  listProjects,
  openProject,
} from "../projects/projects-service.js";

export function registerProjectsIpc(): void {
  ipcMain.handle("projects:list", listProjects);
  ipcMain.handle("projects:create", createProject);
  ipcMain.handle("projects:open", (_event, projectId: string) => openProject(projectId));
  ipcMain.handle("projects:delete", (_event, projectId: string) => deleteProject(projectId));
  ipcMain.handle("projects:create-conversation", (_event, projectId: string, title: string) => createConversation(projectId, title));
  ipcMain.handle("projects:delete-conversation", (_event, projectId: string, conversationId: string) => deleteConversation(projectId, conversationId));
}
