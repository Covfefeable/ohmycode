import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { assertInside } from "./workspace.js";

export type AgentInstruction = { path: string; content: string };

export async function loadAgentInstructions(root: string, target = root): Promise<AgentInstruction[]> {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  assertInside(resolvedRoot, resolvedTarget);
  let directory = resolvedTarget;
  try { if ((await stat(resolvedTarget)).isFile()) directory = path.dirname(resolvedTarget); } catch { directory = path.dirname(resolvedTarget); }
  const relative = path.relative(resolvedRoot, directory);
  const segments = relative ? relative.split(path.sep) : [];
  const directories = [resolvedRoot];
  for (let index = 0; index < segments.length; index += 1) directories.push(path.join(resolvedRoot, ...segments.slice(0, index + 1)));
  const instructions: AgentInstruction[] = [];
  for (const current of directories) {
    const instructionPath = path.join(current, "AGENTS.md");
    try {
      const content = await readFile(instructionPath, "utf8");
      if (content.trim()) instructions.push({ path: instructionPath, content });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return instructions;
}

export function renderAgentInstructions(instructions: AgentInstruction[]): string {
  if (!instructions.length) return "";
  return instructions.map((item) => `Instructions from ${item.path}:\n${item.content.trim()}`).join("\n\n");
}
