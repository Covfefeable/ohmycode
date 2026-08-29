import path from "node:path";
import { readdir, readFile, stat, writeFile, mkdir, unlink, realpath } from "node:fs/promises";
import type { Dirent } from "node:fs";
import { loadAgentInstructions } from "./agents-instructions.js";
import type { FileToolName, FileToolRequest, FileToolResult } from "./types.js";
import { assertInside, safeExistingPath, safeExplicitFile, safeNewPath, workspaceDirectory } from "./workspace.js";

const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "dist-electron", "release", ".venv", "__pycache__", ".pytest_cache"]);
const DEFAULT_SEARCH_RESULTS = 50;
const MAX_SEARCH_RESULTS = 200;
const DEFAULT_OUTPUT_CHARS = 8_000;
const MAX_OUTPUT_CHARS = 32_000;
const MAX_DIFF_CONTENT_CHARS = 512_000;

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  return Math.max(1, Math.min(value ?? fallback, maximum));
}

function globPattern(value?: string): RegExp | null {
  if (!value) return null;
  const escaped = value.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "§§").replace(/\*/g, "[^/]*").replace(/§§/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

async function walk(root: string, includeHidden: boolean, maximum: number): Promise<Array<{ path: string; entry: Dirent }>> {
  const results: Array<{ path: string; entry: Dirent }> = [];
  const pending = [root];
  while (pending.length && results.length < maximum) {
    const current = pending.shift()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if ((!includeHidden && entry.name.startsWith(".")) || (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))) continue;
      const target = path.join(current, entry.name);
      results.push({ path: target, entry });
      if (entry.isDirectory()) pending.push(target);
      if (results.length >= maximum) break;
    }
  }
  return results;
}

async function readFileTool(root: string, request: FileToolRequest, allowedPaths: Set<string>): Promise<FileToolResult> {
  let target: string;
  const requestedPath = request.path ?? ".";
  try {
    target = await safeExistingPath(root, requestedPath);
  } catch (error) {
    if (!path.isAbsolute(requestedPath)) throw error;
    target = await safeExplicitFile(requestedPath, allowedPaths);
  }
  if (!(await stat(target)).isFile()) throw new Error("not_a_file");
  const maximum = bounded(request.maxBytes, 64 * 1024, 256 * 1024);
  const buffer = await readFile(target);
  if (buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0)) throw new Error("binary_file_not_supported");
  const allLines = buffer.toString("utf8").split(/\r?\n/);
  const start = Math.max(1, request.startLine ?? 1);
  const end = Math.min(allLines.length, request.endLine ?? allLines.length);
  let output = allLines.slice(start - 1, end).map((line, index) => `${start + index}: ${line}`).join("\n");
  const truncated = Buffer.byteLength(output) > maximum || end < allLines.length;
  if (Buffer.byteLength(output) > maximum) output = Buffer.from(output).subarray(0, maximum).toString("utf8");
  return { operation: "read_file", path: target, pathKind: "file", output, truncated, agentInstructions: await loadAgentInstructions(root, target) };
}

async function listDirectory(root: string, request: FileToolRequest): Promise<FileToolResult> {
  const target = await safeExistingPath(root, request.path);
  if (!(await stat(target)).isDirectory()) throw new Error("not_a_directory");
  const maximum = bounded(request.maxEntries, 200, 1000);
  const maxDepth = Math.max(1, Math.min(request.depth ?? 1, 5));
  const maxChars = bounded(request.maxChars, DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS);
  const lines: string[] = [];
  let outputChars = 0;
  let outputLimited = false;
  async function visit(directory: string, depth: number): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (lines.length >= maximum || outputLimited) return;
      if ((!request.includeHidden && entry.name.startsWith(".")) || (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name))) continue;
      const item = path.join(directory, entry.name);
      const relative = path.relative(target, item) || entry.name;
      const size = entry.isFile() ? (await stat(item)).size : 0;
      const line = `${entry.isDirectory() ? "directory" : "file"}\t${relative}${entry.isFile() ? `\t${size}` : ""}`;
      if (lines.length < maximum && outputChars + line.length + (lines.length ? 1 : 0) <= maxChars) {
        lines.push(line);
        outputChars += line.length + (lines.length > 1 ? 1 : 0);
      } else {
        outputLimited = true;
      }
      if (entry.isDirectory() && depth < maxDepth) await visit(item, depth + 1);
    }
  }
  await visit(target, 1);
  const truncated = outputLimited || lines.length >= maximum;
  return { operation: "list_directory", path: target, pathKind: "directory", output: lines.join("\n"), truncated, truncationHint: truncated ? "Result truncated. Use a narrower path or smaller depth." : undefined, agentInstructions: await loadAgentInstructions(root, target) };
}

async function searchFiles(root: string, request: FileToolRequest): Promise<FileToolResult> {
  const target = await safeExistingPath(root, request.path);
  const maximum = bounded(request.maxResults, DEFAULT_SEARCH_RESULTS, MAX_SEARCH_RESULTS);
  const maxChars = bounded(request.maxChars, DEFAULT_OUTPUT_CHARS, MAX_OUTPUT_CHARS);
  const entries = await walk(target, Boolean(request.includeHidden), 20_000);
  const matcher = globPattern(request.glob);
  const query = String(request.query ?? "");
  if (!query) throw new Error("query_required");
  const results: string[] = [];
  let outputChars = 0;
  let totalMatches = 0;
  let outputLimited = false;
  const record = (value: string) => {
    totalMatches += 1;
    if (results.length >= maximum || outputChars + value.length + (results.length ? 1 : 0) > maxChars) {
      outputLimited = true;
      return;
    }
    results.push(value);
    outputChars += value.length + (results.length > 1 ? 1 : 0);
  };
  for (const item of entries) {
    if (!item.entry.isFile()) continue;
    const relative = path.relative(root, item.path).split(path.sep).join("/");
    if (matcher && !matcher.test(relative)) continue;
    if (request.mode === "files") {
      if (relative.toLocaleLowerCase().includes(query.toLocaleLowerCase())) record(item.path);
    } else {
      const info = await stat(item.path);
      if (info.size > 1024 * 1024) continue;
      const buffer = await readFile(item.path);
      if (buffer.subarray(0, Math.min(buffer.length, 4096)).includes(0)) continue;
      buffer.toString("utf8").split(/\r?\n/).forEach((line, index) => {
        if (line.toLocaleLowerCase().includes(query.toLocaleLowerCase())) record(`${item.path}:${index + 1}: ${line.trim()}`);
      });
    }
  }
  return { operation: "search_files", path: target, pathKind: "directory", output: results.join("\n"), truncated: outputLimited, totalMatches, returnedMatches: results.length, truncationHint: outputLimited ? "Result truncated. Use a narrower query/path/glob or read_file for an exact range." : undefined, agentInstructions: await loadAgentInstructions(root, target) };
}

type PatchOperation = { kind: "add" | "update" | "delete"; path: string; lines: string[] };

function parsePatch(value: string): PatchOperation[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  if (lines[0] !== "*** Begin Patch") throw new Error("invalid_patch_format: expected '*** Begin Patch'");
  const operations: PatchOperation[] = [];
  let current: PatchOperation | null = null;
  for (const line of lines.slice(1)) {
    const header = line.match(/^\*\*\* (Add|Update|Delete) File: (.+)$/);
    if (header) {
      current = { kind: header[1].toLocaleLowerCase() as PatchOperation["kind"], path: header[2], lines: [] };
      operations.push(current);
    } else if (line === "*** End Patch") break;
    else if (current) current.lines.push(line);
  }
  if (!operations.length) throw new Error("empty_patch");
  return operations;
}

function applyUpdate(original: string, patchLines: string[]): string {
  const source = original.replace(/\r\n/g, "\n").split("\n");
  const hunks: string[][] = [];
  let hunk: string[] = [];
  for (const line of patchLines) {
    if (line.startsWith("@@")) { if (hunk.length) hunks.push(hunk); hunk = []; }
    else hunk.push(line);
  }
  if (hunk.length) hunks.push(hunk);
  for (const lines of hunks) {
    if (!lines.length || lines.some((line) => !line || ![" ", "+", "-"].includes(line[0]))) throw new Error("invalid_patch_hunk");
    const before = lines.filter((line) => !line.startsWith("+")).map((line) => line.slice(1));
    const after = lines.filter((line) => !line.startsWith("-")).map((line) => line.slice(1));
    const index = source.findIndex((_line, start) => before.every((value, offset) => source[start + offset] === value));
    if (index < 0) throw new Error("patch_context_mismatch");
    source.splice(index, before.length, ...after);
  }
  return source.join("\n");
}

async function applyPatch(root: string, request: FileToolRequest, inspectedPaths: Set<string>): Promise<FileToolResult> {
  const operations = parsePatch(String(request.patch ?? ""));
  const duplicates = operations.map((operation) => path.normalize(operation.path));
  if (new Set(duplicates).size !== duplicates.length) throw new Error("duplicate_patch_target");
  const planned: Array<PatchOperation & { target: string; original: string; content?: string }> = [];
  for (const operation of operations) {
    if (operation.kind === "add") {
      const target = await safeNewPath(root, operation.path);
      try {
        await stat(target);
        throw new Error(`file_already_exists:${target}`);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      planned.push({ ...operation, target, original: "", content: operation.lines.map((line) => line.startsWith("+") ? line.slice(1) : line).join("\n") });
      continue;
    }
    const target = await safeExistingPath(root, operation.path);
    if (!(await stat(target)).isFile()) throw new Error(`not_a_file:${target}`);
    if (!inspectedPaths.has(target)) throw new Error(`inspection_required:${target}`);
    const original = await readFile(target, "utf8");
    const content = operation.kind === "update" ? applyUpdate(original, operation.lines) : undefined;
    planned.push({ ...operation, target, original, content });
  }
  for (const operation of planned) {
    const { target } = operation;
    if (operation.kind === "add") {
      await mkdir(path.dirname(target), { recursive: true });
      const parent = await realpath(path.dirname(target));
      assertInside(await realpath(root), parent);
      await writeFile(target, operation.content ?? "", { encoding: "utf8", flag: "wx" });
    } else if (operation.kind === "delete") {
      await unlink(target);
    } else {
      await writeFile(target, operation.content ?? "", "utf8");
    }
  }
  const affectedPaths = planned.map((operation) => operation.target);
  const changes = planned.map((operation) => {
    const modified = operation.kind === "delete" ? "" : operation.content ?? "";
    if (operation.original.length + modified.length > MAX_DIFF_CONTENT_CHARS) {
      return { path: operation.target, diffUnavailable: "file_too_large" as const };
    }
    return { path: operation.target, original: operation.original, modified };
  });
  return { operation: "apply_patch", path: affectedPaths[0] ?? root, pathKind: "file", affectedPaths, changes, output: `Updated ${affectedPaths.length} file(s).`, agentInstructions: await loadAgentInstructions(root, affectedPaths[0] ?? root) };
}

export async function executeFileTool(name: FileToolName, request: FileToolRequest, workspaceRoot?: string, inspectedPaths = new Set<string>(), allowedPaths = new Set<string>()): Promise<FileToolResult> {
  const root = await workspaceDirectory(request.projectId, workspaceRoot);
  if (name === "read_file") return readFileTool(root, request, allowedPaths);
  if (name === "search_files") return searchFiles(root, request);
  if (name === "list_directory") return listDirectory(root, request);
  return applyPatch(root, request, inspectedPaths);
}
