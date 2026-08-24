import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import type { StoredProjects } from "./types.js";

const projectsFile = () => path.join(app.getPath("userData"), "projects.json");

export async function readProjects(): Promise<StoredProjects> {
  try {
    return JSON.parse(await readFile(projectsFile(), "utf8")) as StoredProjects;
  } catch {
    return { projects: [] };
  }
}

export async function writeProjects(data: StoredProjects): Promise<void> {
  await writeFile(projectsFile(), JSON.stringify(data, null, 2), "utf8");
}
