import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, readFile, writeFile, unlink, realpath, symlink, readdir, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import process from "node:process";
import { WorkspaceSnapshots } from "../../dist-electron/files/workspace-snapshots.js";

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ohmycode-snapshots-")));
  const root = path.join(directory, "workspace");
  await mkdir(root);
  const git = (...args) => execFileSync("git", ["-C", root, ...args], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  git("init", "--template=");
  git("config", "user.name", "Snapshot test"); git("config", "user.email", "snapshot@example.invalid");
  await writeFile(path.join(root, "tracked.txt"), "committed\n");
  await writeFile(path.join(root, "deleted.txt"), "restore deletion\n");
  await writeFile(path.join(root, ".gitignore"), "ignored/\n");
  git("add", "."); git("commit", "-qm", "baseline");
  const storePath = path.join(directory, "store");
  return { root, git, storePath, snapshots: new WorkspaceSnapshots(storePath) };
}

test("captures terminal edits, restores dirty baseline and leaves user index and refs unchanged", async () => {
  const { root, git, snapshots, storePath } = await fixture();
  await writeFile(path.join(root, "tracked.txt"), Buffer.from("user staged\r\n"));
  git("add", "tracked.txt");
  await writeFile(path.join(root, "tracked.txt"), Buffer.from("user unstaged\r\n"));
  const index = await readFile(path.join(root, ".git", "index"));
  const head = git("rev-parse", "HEAD");
  const id = await snapshots.begin("thread", "turn", root);
  execFileSync(process.execPath, ["-e", "const fs=require('fs');fs.writeFileSync('tracked.txt','agent');fs.writeFileSync('新增 文件.txt','new');fs.unlinkSync('deleted.txt')"], { cwd: root, windowsHide: true });
  await snapshots.finish(id);
  const [record] = await snapshots.list("thread");
  assert.equal(record.status, "ready");
  assert.deepEqual(record.files.map(({ path, operation }) => [path, operation]).sort(), [["deleted.txt", "deleted"], ["tracked.txt", "modified"], ["新增 文件.txt", "added"]].sort());
  assert.equal((await snapshots.detail("thread", id, "tracked.txt")).original, "user unstaged\r\n");
  const reopened = new WorkspaceSnapshots(storePath);
  for (const file of record.files) await reopened.restore("thread", id, file.path);
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "user unstaged\r\n");
  assert.equal(await readFile(path.join(root, "deleted.txt"), "utf8"), "restore deletion\n");
  await assert.rejects(readFile(path.join(root, "新增 文件.txt")), { code: "ENOENT" });
  assert.deepEqual(await readFile(path.join(root, ".git", "index")), index);
  assert.deepEqual(git("rev-parse", "HEAD"), head);
  assert.ok((await reopened.list("thread"))[0].files.every((file) => file.restored));
});

test("protects later edits, rejects foreign threads and active snapshots", async () => {
  const { root, snapshots } = await fixture();
  const id = await snapshots.begin("thread", "turn", root);
  await writeFile(path.join(root, "tracked.txt"), "agent");
  await snapshots.finish(id, true);
  await assert.rejects(snapshots.restore("thread", id, "tracked.txt"), /snapshot_not_restorable/);
  await snapshots.finish(id);
  await assert.rejects(snapshots.detail("foreign", id, "tracked.txt"), /snapshot_not_found/);
  await assert.rejects(snapshots.restore("foreign", id, "tracked.txt"), /snapshot_not_restorable/);
  await writeFile(path.join(root, "tracked.txt"), "user edited later");
  await assert.rejects(snapshots.restore("thread", id, "tracked.txt"), /snapshot_conflict/);
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "user edited later");
  await assert.rejects(snapshots.restore("thread", id, "../outside"), /snapshot_not_restorable/);
});

test("excludes secrets, ignored paths and oversized files without presenting them as deletions", async () => {
  const { root, snapshots } = await fixture();
  await writeFile(path.join(root, ".env"), "not stored");
  await mkdir(path.join(root, "ignored"));
  await writeFile(path.join(root, "ignored", "file"), "ignored");
  const id = await snapshots.begin("thread", "turn", root);
  await writeFile(path.join(root, "tracked.txt"), Buffer.alloc(2 * 1024 * 1024 + 1));
  await snapshots.finish(id);
  const [record] = await snapshots.list("thread");
  assert.ok(record.excluded.includes(".env"));
  assert.ok(record.excluded.includes("tracked.txt"));
  assert.deepEqual(record.files, []);
});

test("restores binary bytes; previews reject binary content", async () => {
  const { root, snapshots } = await fixture();
  const bytes = Buffer.from([0, 255, 1, 13, 10]);
  await writeFile(path.join(root, "binary.bin"), bytes);
  const id = await snapshots.begin("thread", "turn", root);
  await unlink(path.join(root, "binary.bin"));
  await snapshots.finish(id);
  await assert.rejects(snapshots.detail("thread", id, "binary.bin"), /snapshot_binary_file/);
  await snapshots.restore("thread", id, "binary.bin");
  assert.deepEqual(await readFile(path.join(root, "binary.bin")), bytes);
});

test("rejects symlink restoration rather than writing through a replaced file", async () => {
  const { root, snapshots } = await fixture();
  const id = await snapshots.begin("thread", "turn", root);
  await writeFile(path.join(root, "tracked.txt"), "agent");
  await snapshots.finish(id);
  await unlink(path.join(root, "tracked.txt"));
  try { await symlink(path.join(root, "deleted.txt"), path.join(root, "tracked.txt")); }
  catch (error) { if (error.code === "EPERM") return; throw error; }
  await assert.rejects(snapshots.restore("thread", id, "tracked.txt"), /snapshot_conflict/);
  assert.equal(await readFile(path.join(root, "deleted.txt"), "utf8"), "restore deletion\n");
});

test("non-Git workspace is explicitly unavailable and does not fail a chat", async () => {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), "ohmycode-no-git-")));
  const root = path.join(directory, "workspace"); await mkdir(root);
  const snapshots = new WorkspaceSnapshots(path.join(directory, "store"));
  const id = await snapshots.begin("thread", "turn", root);
  await snapshots.finish(id);
  assert.equal((await snapshots.list("thread"))[0].status, "unavailable");
});

test("snapshot refs work beyond Windows MAX_PATH in the real application storage layout", async () => {
  const { root, storePath } = await fixture();
  const deepStore = path.join(storePath, "account".repeat(5), "workspace".repeat(4));
  const snapshots = new WorkspaceSnapshots(deepStore);
  const id = await snapshots.begin("thread", "turn", root);
  const workspace = (await readdir(deepStore)).find((name) => name !== "records");
  assert.ok(path.join(deepStore, workspace, "repository.git", "refs", "snapshots", id, "before").length > 260);
  const [record] = await snapshots.list("thread");
  assert.equal(record.status, "active", JSON.stringify({ error: record.error, store: deepStore, node: process.version }));
  await writeFile(path.join(root, "tracked.txt"), "agent edit");
  await snapshots.finish(id);
  assert.equal((await snapshots.list("thread"))[0].status, "ready");
  await snapshots.restore("thread", id, "tracked.txt");
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "committed\n");
});

test("a Git ref failure produces an unavailable snapshot instead of rejecting the chat preparation", async () => {
  const { root, storePath, snapshots } = await fixture();
  await snapshots.begin("first", "turn", root);
  const workspace = (await readdir(storePath)).find((name) => name !== "records");
  const refs = path.join(storePath, workspace, "repository.git", "refs");
  await rename(path.join(refs, "snapshots"), path.join(refs, "saved"));
  await writeFile(path.join(refs, "snapshots"), "blocked reference directory");
  const id = await snapshots.begin("second", "turn", root);
  await snapshots.finish(id);
  const [record] = await snapshots.list("second");
  assert.equal(record.status, "unavailable");
  assert.equal(record.error, "snapshot_refs_failed");
});

test("restores all remaining files in the selected Turn without touching another Turn", async () => {
  const { root, snapshots } = await fixture();
  const first = await snapshots.begin("thread", "first", root);
  await writeFile(path.join(root, "tracked.txt"), "first turn");
  await snapshots.finish(first);
  const second = await snapshots.begin("thread", "second", root);
  await writeFile(path.join(root, "tracked.txt"), "second turn");
  await writeFile(path.join(root, "new.txt"), "added");
  await unlink(path.join(root, "deleted.txt"));
  await snapshots.finish(second);
  await snapshots.restore("thread", second, "new.txt");
  await assert.rejects(snapshots.restoreAll("thread", first), /snapshot_conflict/);
  await assert.rejects(snapshots.restoreAll("foreign", second), /snapshot_not_restorable/);
  await snapshots.restoreAll("thread", second);
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "first turn");
  assert.equal(await readFile(path.join(root, "deleted.txt"), "utf8"), "restore deletion\n");
  await assert.rejects(readFile(path.join(root, "new.txt")), { code: "ENOENT" });
  assert.ok((await snapshots.list("thread")).find((record) => record.id === second).files.every((file) => file.restored));
  assert.ok((await snapshots.list("thread")).find((record) => record.id === first).files.every((file) => !file.restored));
});

test("a later file conflict prevents any file in the batch from being restored", async () => {
  const { root, snapshots } = await fixture();
  const id = await snapshots.begin("thread", "turn", root);
  await writeFile(path.join(root, "deleted.txt"), "agent first file");
  await writeFile(path.join(root, "tracked.txt"), "agent second file");
  await snapshots.finish(id);
  await writeFile(path.join(root, "tracked.txt"), "later user edit");
  await assert.rejects(snapshots.restoreAll("thread", id), /snapshot_conflict/);
  assert.equal(await readFile(path.join(root, "deleted.txt"), "utf8"), "agent first file");
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "later user edit");
  assert.ok((await snapshots.list("thread"))[0].files.every((file) => !file.restored));
});
