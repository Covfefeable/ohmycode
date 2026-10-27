import { app, dialog } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readSkillArchive } from "./skill-archive.js";
import { apiFetch, apiRequest } from "../api/api-client.js";
import type { SkillRecord } from "../../contracts/domain.js";

const skillRoot = (): string => path.join(app.getPath("userData"), "skills");
const skillDirectory = (id: string): string => path.join(skillRoot(), createHash("sha256").update(id).digest("hex"));

function metadata(markdown: string, fallback: string): { name: string; description: string; version: string } {
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/i)?.[1] ?? "";
  const read = (key: string) => frontmatter.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "mi"))?.[1]?.trim();
  const title = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return {
    name: read("name") || title || fallback,
    description: read("description") || "",
    version: read("version") || "1.0.0",
  };
}

function parseArchive(archive: Buffer) {
  const entries = readSkillArchive(new Uint8Array(archive));
  const names = Object.keys(entries).filter((name) => !name.endsWith("/"));
  if (!names.length) throw new Error("invalid_skill_archive");
  const normalized = names.map((name) => name.replaceAll("\\", "/"));
  if (normalized.some((name) => name.startsWith("/") || name.split("/").includes(".."))) throw new Error("invalid_skill_archive_path");
  const skillFile = normalized.find((name) => name === "SKILL.md") ?? normalized.find((name) => name.endsWith("/SKILL.md"));
  if (!skillFile) throw new Error("skill_manifest_missing");
  const prefix = skillFile.slice(0, -"SKILL.md".length);
  const manifest = new TextDecoder().decode(entries[names[normalized.indexOf(skillFile)]]);
  const info = metadata(manifest, path.basename(prefix.replace(/\/$/, "")) || "skill");
  return { entries, names, normalized, prefix, info };
}

async function extractArchive(id: string, parsed: ReturnType<typeof parseArchive>): Promise<void> {
  const { entries, names, normalized, prefix } = parsed;
  const directory = skillDirectory(id);
  const staging = `${directory}.installing-${randomUUID()}`;
  await rm(staging, { recursive: true, force: true });
  for (let index = 0; index < names.length; index += 1) {
    const relative = normalized[index].startsWith(prefix) ? normalized[index].slice(prefix.length) : "";
    if (!relative) continue;
    const target = path.join(staging, ...relative.split("/"));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, entries[names[index]]);
  }
  await rm(directory, { recursive: true, force: true });
  await mkdir(path.dirname(directory), { recursive: true });
  await rename(staging, directory);
}

export async function listSkills(): Promise<SkillRecord[]> {
  const skills = (await apiRequest<{ skills: Omit<SkillRecord, "installed">[] }>("/api/capabilities/skills")).skills;
  return Promise.all(skills.map(async (skill) => ({ ...skill, installed: await stat(path.join(skillDirectory(skill.id), "SKILL.md")).then(() => true).catch(() => false) })));
}

export async function installSkill(): Promise<SkillRecord | null> {
  const selection = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Skill archive", extensions: ["zip"] }] });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const archive = await readFile(selection.filePaths[0]);
  const parsed = parseArchive(archive);
  const { info } = parsed;
  const saved = await apiRequest<Omit<SkillRecord, "installed">>("/api/capabilities/skills", {
    method: "POST",
    body: JSON.stringify({
      name: info.name,
      description: info.description,
      version: info.version,
      archive: archive.toString("base64"),
      sha256: createHash("sha256").update(archive).digest("hex"),
      enabled: true,
    }),
  });
  await extractArchive(saved.id, parsed);
  return { ...saved, installed: true };
}

export async function downloadSkill(id: string): Promise<SkillRecord> {
  const skills = await listSkills();
  const skill = skills.find((item) => item.id === id);
  if (!skill) throw new Error("skill_not_found");
  const response = await apiFetch(`/api/capabilities/skills/${id}/archive`);
  if (!response.ok) throw new Error("skill_download_failed");
  const archive = Buffer.from(await response.arrayBuffer());
  const digest = createHash("sha256").update(archive).digest("hex");
  if (digest !== skill.sha256 || response.headers.get("x-content-sha256") !== digest) {
    throw new Error("skill_archive_checksum_mismatch");
  }
  await extractArchive(skill.id, parseArchive(archive));
  return { ...skill, installed: true };
}

export async function removeLocalSkill(id: string): Promise<void> {
  await rm(skillDirectory(id), { recursive: true, force: true });
}

export async function deleteSkill(id: string): Promise<void> {
  await apiRequest(`/api/capabilities/skills/${id}`, { method: "DELETE" });
  await removeLocalSkill(id);
}

export async function loadSkillInstructions(id: string): Promise<string> {
  return readFile(path.join(skillDirectory(id), "SKILL.md"), "utf8");
}
