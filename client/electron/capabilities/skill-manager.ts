import { app, dialog } from "electron";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { apiFetch, apiRequest } from "../api/api-client.js";
import type { SkillRecord } from "./types.js";

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 500;

const skillRoot = (): string => path.join(app.getPath("userData"), "skills");
const safeSegment = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "skill";

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

async function extractArchive(archive: Buffer): Promise<{ name: string; description: string; version: string; directory: string }> {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("skill_archive_too_large");
  const entries = unzipSync(new Uint8Array(archive));
  const names = Object.keys(entries).filter((name) => !name.endsWith("/"));
  if (!names.length || names.length > MAX_FILES) throw new Error("invalid_skill_archive");
  const normalized = names.map((name) => name.replaceAll("\\", "/"));
  if (normalized.some((name) => name.startsWith("/") || name.split("/").includes(".."))) throw new Error("invalid_skill_archive_path");
  const skillFile = normalized.find((name) => name === "SKILL.md") ?? normalized.find((name) => name.endsWith("/SKILL.md"));
  if (!skillFile) throw new Error("skill_manifest_missing");
  const total = names.reduce((sum, name) => sum + entries[name].byteLength, 0);
  if (total > MAX_EXTRACTED_BYTES) throw new Error("skill_extracted_too_large");
  const prefix = skillFile.slice(0, -"SKILL.md".length);
  const manifest = new TextDecoder().decode(entries[names[normalized.indexOf(skillFile)]]);
  const info = metadata(manifest, path.basename(prefix.replace(/\/$/, "")) || "skill");
  const directory = path.join(skillRoot(), safeSegment(info.name));
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
  return { ...info, directory };
}

export async function listSkills(): Promise<SkillRecord[]> {
  const skills = (await apiRequest<{ skills: Omit<SkillRecord, "installed">[] }>("/api/capabilities/skills")).skills;
  return Promise.all(skills.map(async (skill) => ({ ...skill, installed: await stat(path.join(skillRoot(), safeSegment(skill.name), "SKILL.md")).then(() => true).catch(() => false) })));
}

export async function installSkill(): Promise<SkillRecord | null> {
  const selection = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: "Skill archive", extensions: ["zip"] }] });
  if (selection.canceled || !selection.filePaths[0]) return null;
  const archive = await readFile(selection.filePaths[0]);
  const info = await extractArchive(archive);
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
  await extractArchive(archive);
  return { ...skill, installed: true };
}

export async function removeLocalSkill(name: string): Promise<void> {
  await rm(path.join(skillRoot(), safeSegment(name)), { recursive: true, force: true });
}

export async function deleteSkill(id: string, name: string): Promise<void> {
  await apiRequest(`/api/capabilities/skills/${id}`, { method: "DELETE" });
  await removeLocalSkill(name);
}

export function enabledSkillCatalog(): Promise<SkillRecord[]> {
  return listSkills().then((skills) => skills.filter((skill) => skill.enabled && skill.installed));
}

export async function loadSkillInstructions(name: string): Promise<string> {
  return readFile(path.join(skillRoot(), safeSegment(name), "SKILL.md"), "utf8");
}
