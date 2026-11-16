import path from "node:path";
import { createHash } from "node:crypto";
import { app } from "electron";
import { readTokens } from "../auth/token-store.js";
import { getApiUrl } from "../config.js";
import { getConversation } from "../projects/projects-service.js";
import { workspaceHasRunningTerminal, onWorkspaceTerminalExit } from "../terminal/terminal-manager.js";
import { WorkspaceSnapshots } from "./workspace-snapshots.js";

const stores = new Map<string, WorkspaceSnapshots>();
const active = new Map<string, number>();
let restoring = false;
let readTurnRequest: (threadId: string, turnId: string) => string | undefined = () => undefined;

export function setSnapshotRequestReader(reader: typeof readTurnRequest): void {
  readTurnRequest = reader;
}

async function store(): Promise<WorkspaceSnapshots> {
  const tokens = await readTokens();
  if (!tokens) throw new Error("authentication_required");
  const { sub } = JSON.parse(Buffer.from(tokens.accessToken.split(".")[1], "base64url").toString()) as { sub: string };
  const key = createHash("sha256").update(`${getApiUrl()}:${sub}`).digest("hex");
  let value = stores.get(key);
  if (!value) { value = new WorkspaceSnapshots(path.join(app.getPath("userData"), "snapshots", key)); stores.set(key, value); }
  return value;
}

export async function beginWorkspaceSnapshot(threadId: string, turnId: string, workspace: string) {
  const snapshots = await store();
  if (restoring) throw new Error("snapshot_workspace_busy");
  const root = path.resolve(workspace);
  active.set(root, (active.get(root) ?? 0) + 1);
  let id: string;
  try { id = await snapshots.begin(threadId, turnId, root); }
  catch (error) { active.set(root, (active.get(root) ?? 1) - 1); throw error; }
  let turnRunning = true;
  const stillRunning = () => turnRunning || workspaceHasRunningTerminal(root);
  const detach = onWorkspaceTerminalExit(root, () => {
    void snapshots.finish(id, stillRunning).finally(() => { if (!stillRunning()) detach(); }).catch(console.error);
  });
  return {
    finish: async () => {
      turnRunning = false;
      active.set(root, (active.get(root) ?? 1) - 1);
      try { await snapshots.finish(id, stillRunning); }
      finally { if (!stillRunning()) detach(); }
    },
  };
}

export async function listWorkspaceSnapshots(threadId: string) {
  await getConversation(threadId);
  const records = await (await store()).list(threadId);
  const busy = [...active.values()].some((count) => count > 0) || workspaceHasRunningTerminal();
  return records.map((record) => ({
    ...record,
    userRequest: readTurnRequest(threadId, record.turnId),
    ...(record.status === "active" && !busy ? { status: "unavailable" as const, error: "snapshot_interrupted" } : {}),
  }));
}

export async function workspaceSnapshotDetail(threadId: string, id: string, file: string) {
  await getConversation(threadId);
  return (await store()).detail(threadId, id, file);
}

export async function restoreWorkspaceFile(threadId: string, id: string, file: string) {
  return restoreWorkspaceFiles(threadId, id, file);
}

export async function restoreWorkspaceTurn(threadId: string, id: string) {
  return restoreWorkspaceFiles(threadId, id);
}

async function restoreWorkspaceFiles(threadId: string, id: string, file?: string) {
  await getConversation(threadId);
  // Also block after restart: running records remain active and require a fresh completed snapshot.
  if ([...active.values()].some((count) => count > 0) || workspaceHasRunningTerminal()) throw new Error("snapshot_workspace_busy");
  if (restoring) throw new Error("snapshot_workspace_busy");
  restoring = true;
  try {
    const snapshots = await store();
    if (file === undefined) await snapshots.restoreAll(threadId, id);
    else await snapshots.restore(threadId, id, file);
  }
  finally { restoring = false; }
}
