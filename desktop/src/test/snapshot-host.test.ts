import { Buffer } from "node:buffer";
import { expect, test, vi } from "vitest";
import { beginWorkspaceSnapshot, restoreWorkspaceFile, restoreWorkspaceTurn, listWorkspaceSnapshots, setSnapshotRequestReader } from "../../electron/files/snapshot-host";
import type { WorkspaceChangeSet } from "../../contracts/domain";

const mocks = vi.hoisted(() => ({ running: false, exited: () => {}, detach: vi.fn(), finish: vi.fn(), restore: vi.fn(), restoreAll: vi.fn(), records: [] as WorkspaceChangeSet[], access: vi.fn(async () => ({})) }));
vi.mock("electron", () => ({ app: { getPath: () => "/snapshot-test" } }));
vi.mock("../../electron/config", () => ({ getApiUrl: () => "https://snapshot.example.invalid" }));
vi.mock("../../electron/auth/token-store", () => ({ readTokens: async () => ({ accessToken: `header.${Buffer.from(JSON.stringify({ sub: "user" })).toString("base64url")}.signature` }) }));
vi.mock("../../electron/projects/projects-service", () => ({ getConversation: mocks.access }));
vi.mock("../../electron/terminal/terminal-manager", () => ({ workspaceHasRunningTerminal: () => mocks.running, onWorkspaceTerminalExit: (_root: string, callback: () => void) => { mocks.exited = callback; return mocks.detach; } }));
vi.mock("../../electron/files/workspace-snapshots", () => ({
  WorkspaceSnapshots: class {
    async begin() { return "snapshot"; }
    async finish(_id: string, active: boolean | (() => boolean)) { mocks.finish(typeof active === "function" ? active() : active); }
    restore = mocks.restore;
    restoreAll = mocks.restoreAll;
    async list() { return mocks.records; }
  },
}));

test("running Turns and surviving terminals block restore; terminal exit finalizes and restore blocks new Turns", async () => {
  const snapshot = await beginWorkspaceSnapshot("thread", "turn", "/workspace");
  await expect(restoreWorkspaceFile("thread", "snapshot", "file")).rejects.toThrow("snapshot_workspace_busy");
  mocks.running = true;
  await snapshot.finish();
  expect(mocks.finish).toHaveBeenLastCalledWith(true);
  await expect(restoreWorkspaceFile("thread", "snapshot", "file")).rejects.toThrow("snapshot_workspace_busy");
  mocks.running = false;
  mocks.exited();
  await vi.waitFor(() => expect(mocks.finish).toHaveBeenLastCalledWith(false));
  await vi.waitFor(() => expect(mocks.detach).toHaveBeenCalled());
  let release!: () => void;
  mocks.restore.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
  const restoring = restoreWorkspaceFile("thread", "snapshot", "file");
  await vi.waitFor(() => expect(mocks.restore).toHaveBeenCalledOnce());
  await expect(beginWorkspaceSnapshot("thread", "next", "/workspace")).rejects.toThrow("snapshot_workspace_busy");
  release();
  await restoring;
  expect(mocks.restore).toHaveBeenCalledWith("thread", "snapshot", "file");
  expect(mocks.access).toHaveBeenCalledWith("thread");
});

test("labels each snapshot with the original request for its own Turn and restores a single Turn", async () => {
  mocks.records = ["first", "second"].map((turnId) => ({ id: turnId, turnId, threadId: "thread", createdAt: "2026-11-16T00:00:00Z", status: "ready", files: [{ path: "a.txt", operation: "modified" }], excluded: [] }));
  setSnapshotRequestReader((thread, turn) => thread === "thread" ? `Original request for ${turn}` : undefined);
  const records = await listWorkspaceSnapshots("thread");
  expect(records.map((record) => record.userRequest)).toEqual(["Original request for first", "Original request for second"]);
  await restoreWorkspaceTurn("thread", "second");
  expect(mocks.restoreAll).toHaveBeenCalledWith("thread", "second");
  setSnapshotRequestReader(() => undefined);
});
