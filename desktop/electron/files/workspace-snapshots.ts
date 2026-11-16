import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { deflate } from "node:zlib";
import { promisify } from "node:util";
import { lstat, mkdir, readFile, readdir, realpath, rename, unlink, writeFile, chmod } from "node:fs/promises";
import type { WorkspaceChangeSet } from "../../contracts/domain.js";
import { assertInside, safeNewPath } from "./workspace.js";

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_FILES = 20_000;
const compress = promisify(deflate);
const excludedPath = (value: string) => value.split("/").some((part) =>
  [".git", "node_modules", ".venv", "__pycache__", "dist", "dist-electron", "release"].includes(part)
  || /^\.env(?:\.|$)/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part));
type Entry = { oid: string; mode: string };
type Capture = { tree: string; excluded: string[] };
type RecordData = WorkspaceChangeSet & { root: string; before: Capture; after?: Capture };

/** A private Git object database; never uses the project's index, refs, hooks or filters. */
export class WorkspaceSnapshots {
  private readonly queues = new Map<string, Promise<unknown>>();
  constructor(private readonly directory: string) {}

  private async serial<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(root) ?? Promise.resolve();
    const running = previous.catch(() => undefined).then(operation);
    this.queues.set(root, running);
    try { return await running; }
    finally { if (this.queues.get(root) === running) this.queues.delete(root); }
  }

  private repository(root: string): string {
    return path.join(this.directory, createHash("sha256").update(root).digest("hex"), "repository.git");
  }

  private git(root: string, args: string[], input?: Buffer, source = false): Promise<Buffer> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
    return new Promise((resolve, reject) => {
      const child = spawn("git", ["-c", "core.longpaths=true", "-c", "core.hooksPath=", "-c", "core.fsmonitor=false", "-c", "core.autocrlf=false", "-c", "core.quotePath=false",
        ...(source ? ["-C", root] : ["--git-dir", this.repository(root)]), ...args], {
        cwd: root, windowsHide: true, env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null", GIT_TERMINAL_PROMPT: "0" },
      });
      const chunks: Buffer[] = [];
      let bytes = 0;
      let failure: Error | undefined;
      const timer = setTimeout(() => { failure = new Error("snapshot_git_timeout"); child.kill(); }, 30_000);
      child.stdout.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) { failure = new Error("snapshot_output_limit"); child.kill(); }
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.on("error", (error) => { clearTimeout(timer); reject(error); });
      child.on("close", (code) => { clearTimeout(timer); if (failure || code !== 0) reject(failure ?? new Error("snapshot_git_failed")); else resolve(Buffer.concat(chunks)); });
      child.stdin.on("error", () => undefined);
      child.stdin.end(input);
    });
  }

  private async blob(root: string, bytes: Buffer): Promise<string> {
    const content = Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes]);
    const oid = createHash("sha1").update(content).digest("hex");
    const file = path.join(this.repository(root), "objects", oid.slice(0, 2), oid.slice(2));
    await mkdir(path.dirname(file), { recursive: true });
    try { await lstat(file); return oid; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const temporary = path.join(this.repository(root), "objects", `tmp_obj_${randomUUID()}`);
    await writeFile(temporary, await compress(content), { flag: "wx", mode: 0o600 });
    await rename(temporary, file);
    return oid;
  }

  private async rejectSymlinkParents(root: string, file: string): Promise<void> {
    let current = root;
    for (const part of file.split("/").slice(0, -1)) {
      current = path.join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new Error("snapshot_symlink_path"); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    }
  }

  private async capture(root: string): Promise<Capture> {
    await mkdir(path.dirname(this.repository(root)), { recursive: true });
    try { await lstat(path.join(this.repository(root), "HEAD")); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.git(root, ["init", "--bare", "--object-format=sha1", "--template=", this.repository(root)]);
    }
    const paths = [...new Set((await this.git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], undefined, true)).toString("utf8").split("\0").filter(Boolean))].sort();
    if (paths.length > MAX_FILES) throw new Error("snapshot_file_limit");
    const excluded: string[] = [];
    const rows: string[] = [];
    let total = 0;
    for (const relative of paths) {
      if (excludedPath(relative)) { excluded.push(relative); continue; }
      const absolute = path.resolve(root, relative);
      assertInside(root, absolute);
      try { await this.rejectSymlinkParents(root, relative); }
      catch { excluded.push(relative); continue; }
      let info;
      try { info = await lstat(absolute); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
      if (!info.isFile() || info.size > MAX_FILE_BYTES) { excluded.push(relative); continue; }
      assertInside(root, await realpath(absolute));
      total += info.size;
      if (total > MAX_TOTAL_BYTES) throw new Error("snapshot_size_limit");
      const bytes = await readFile(absolute);
      const after = await lstat(absolute);
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || bytes.length > MAX_FILE_BYTES) throw new Error("snapshot_workspace_changed");
      rows.push(`${process.platform !== "win32" && info.mode & 0o111 ? "100755" : "100644"} ${await this.blob(root, bytes)}\t${relative}\0`);
    }
    await this.git(root, ["read-tree", "--empty"]);
    if (rows.length) await this.git(root, ["update-index", "-z", "--index-info"], Buffer.from(rows.join("")));
    const tree = (await this.git(root, ["write-tree"])).toString().trim();
    return { tree, excluded };
  }

  private async entries(root: string, tree: string): Promise<Map<string, Entry>> {
    const rows = (await this.git(root, ["ls-tree", "-r", "-z", tree])).toString("utf8").split("\0").filter(Boolean);
    return new Map(rows.map((row) => {
      const tab = row.indexOf("\t");
      const [mode, , oid] = row.slice(0, tab).split(" ");
      return [row.slice(tab + 1), { mode, oid }];
    }));
  }

  private recordPath(id: string): string {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("snapshot_not_found");
    return path.join(this.directory, "records", `${id}.json`);
  }

  private async save(record: RecordData): Promise<void> {
    try {
      if (record.before.tree) await this.git(record.root, ["update-ref", `refs/snapshots/${record.id}/before`, record.before.tree]);
      if (record.after?.tree) await this.git(record.root, ["update-ref", `refs/snapshots/${record.id}/after`, record.after.tree]);
    } catch {
      record.status = "unavailable";
      record.error = "snapshot_refs_failed";
    }
    const file = this.recordPath(record.id);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 });
    await rename(temporary, file);
  }

  private load(id: string): Promise<RecordData> { return readFile(this.recordPath(id), "utf8").then((value) => JSON.parse(value) as RecordData); }

  async begin(threadId: string, turnId: string, workspace: string): Promise<string> {
    const root = await realpath(workspace);
    return this.serial(root, async () => {
      let before: Capture;
      let error: string | undefined;
      try { before = await this.capture(root); }
      catch (failure) { before = { tree: "", excluded: [] }; error = failure instanceof Error ? failure.message : "snapshot_failed"; }
      const record: RecordData = { id: randomUUID(), threadId, turnId, root, before, createdAt: new Date().toISOString(), status: "active", files: [], excluded: before.excluded };
      if (error) { record.status = "unavailable"; record.error = error; }
      await this.save(record);
      return record.id;
    });
  }

  async finish(id: string, active: boolean | (() => boolean) = false): Promise<void> {
    const initial = await this.load(id);
    await this.serial(initial.root, async () => {
      const record = await this.load(id);
      if (!record.before.tree) return;
      if (record.status === "ready") return;
      try {
        record.after = await this.capture(record.root);
        const before = await this.entries(record.root, record.before.tree);
        const after = await this.entries(record.root, record.after.tree);
        record.excluded = [...new Set([...record.before.excluded, ...record.after.excluded])];
        record.files = [...new Set([...before.keys(), ...after.keys()])].sort().flatMap((file) => {
          const a = before.get(file), b = after.get(file);
          if (record.excluded.includes(file) || a?.oid === b?.oid && a?.mode === b?.mode) return [];
          return [{ path: file, operation: !a ? "added" as const : !b ? "deleted" as const : "modified" as const }];
        });
        record.status = (typeof active === "function" ? active() : active) ? "active" : "ready";
        delete record.error;
      } catch (error) { record.status = "unavailable"; record.error = error instanceof Error ? error.message : "snapshot_failed"; }
      await this.save(record);
    });
  }

  async list(threadId: string): Promise<WorkspaceChangeSet[]> {
    const names = await readdir(path.join(this.directory, "records")).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return []; throw error; });
    const records = await Promise.all(names.filter((name) => name.endsWith(".json")).map((name) => this.load(name.slice(0, -5))));
    return records.filter((record) => record.threadId === threadId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((record) => ({ id: record.id, threadId: record.threadId, turnId: record.turnId, createdAt: record.createdAt, status: record.status, files: record.files, excluded: record.excluded, error: record.error }));
  }

  async detail(threadId: string, id: string, file: string): Promise<{ path: string; original: string; modified: string }> {
    const record = await this.load(id);
    if (record.threadId !== threadId || !record.after || !record.files.some((item) => item.path === file)) throw new Error("snapshot_not_found");
    const before = (await this.entries(record.root, record.before.tree)).get(file);
    const after = (await this.entries(record.root, record.after.tree)).get(file);
    const content = async (entry?: Entry) => entry ? this.git(record.root, ["cat-file", "blob", entry.oid]) : Buffer.alloc(0);
    const original = await content(before), modified = await content(after);
    if (original.includes(0) || modified.includes(0)) throw new Error("snapshot_binary_file");
    return { path: file, original: original.toString("utf8"), modified: modified.toString("utf8") };
  }

  async restore(threadId: string, id: string, file: string): Promise<void> {
    return this.restoreFiles(threadId, id, [file]);
  }

  async restoreAll(threadId: string, id: string): Promise<void> {
    return this.restoreFiles(threadId, id);
  }

  private async checkRestoreTarget(root: string, file: string, expected?: Entry): Promise<string> {
    const target = await safeNewPath(root, file);
    await this.rejectSymlinkParents(root, file);
    let current: Buffer | undefined;
    let mode: string | undefined;
    try {
      const info = await lstat(target);
      if (!info.isFile() || info.size > MAX_FILE_BYTES) throw new Error("snapshot_conflict");
      assertInside(root, await realpath(target));
      current = await readFile(target);
      mode = process.platform !== "win32" && info.mode & 0o111 ? "100755" : "100644";
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    const oid = current && createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${current.length}\0`), current])).digest("hex");
    if ((oid ?? undefined) !== expected?.oid || mode !== expected?.mode) throw new Error("snapshot_conflict");
    return target;
  }

  private async restoreFiles(threadId: string, id: string, selected?: string[]): Promise<void> {
    const initial = await this.load(id);
    await this.serial(initial.root, async () => {
      const record = await this.load(id);
      if (record.threadId !== threadId || record.status !== "ready" || !record.after) throw new Error("snapshot_not_restorable");
      const files = selected ?? record.files.filter((item) => !item.restored).map((item) => item.path);
      if (!files.length || files.some((file) => !record.files.some((item) => item.path === file && !item.restored))) throw new Error("snapshot_not_restorable");
      const beforeEntries = await this.entries(record.root, record.before.tree);
      const afterEntries = await this.entries(record.root, record.after.tree);
      // Reject existing conflicts across the whole selection before changing any file.
      for (const file of files) await this.checkRestoreTarget(record.root, file, afterEntries.get(file));
      for (const file of files) {
        const before = beforeEntries.get(file), after = afterEntries.get(file);
        const target = await this.checkRestoreTarget(record.root, file, after);
        if (before) {
          const bytes = await this.git(record.root, ["cat-file", "blob", before.oid]);
          await mkdir(path.dirname(target), { recursive: true });
          assertInside(record.root, await realpath(path.dirname(target)));
          await writeFile(target, bytes, { flag: after ? "w" : "wx" });
          if (process.platform !== "win32") await chmod(target, before.mode === "100755" ? 0o755 : 0o644);
        } else await unlink(target);
        record.files = record.files.map((item) => item.path === file ? { ...item, restored: true } : item);
        await this.save(record);
        if (record.status !== "ready") throw new Error("snapshot_not_restorable");
      }
    });
  }
}
