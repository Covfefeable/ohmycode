import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { apiRequest } from "../api/api-client.js";

export type WorkspaceSnapshot = Map<string, string | null>;

function changedPaths(workspacePath: string): string[] {
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z"], {
    cwd: workspacePath,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) return [];
  return result.stdout.split("\0").filter(Boolean).map((line) => {
    const value = line.slice(3);
    return value.includes(" -> ") ? value.split(" -> ").at(-1)! : value;
  });
}

function fileHash(workspacePath: string, relativePath: string): string | null {
  const absolutePath = path.resolve(workspacePath, relativePath);
  if (!existsSync(absolutePath)) return null;
  try {
    return createHash("sha256").update(readFileSync(absolutePath)).digest("hex");
  } catch {
    return null;
  }
}

export function snapshotWorkspace(workspacePath: string): WorkspaceSnapshot {
  return new Map(changedPaths(workspacePath).map((file) => [file, fileHash(workspacePath, file)]));
}

export async function recordWorkspaceChanges(
  nodeId: string,
  workspacePath: string,
  before: WorkspaceSnapshot,
): Promise<void> {
  const after = snapshotWorkspace(workspacePath);
  const files = new Set([...before.keys(), ...after.keys()]);
  const changes = [...files].flatMap((file) => {
    const beforeHash = before.get(file) ?? null;
    const afterHash = after.get(file) ?? null;
    if (beforeHash === afterHash) return [];
    const operation = beforeHash === null ? "added" : afterHash === null ? "deleted" : "modified";
    return [{ path: file, operation, beforeHash, afterHash }];
  });
  if (changes.length) {
    await apiRequest(`/api/multi-agents/nodes/${nodeId}/changes`, {
      method: "POST",
      body: JSON.stringify({ changes }),
    });
  }
}
