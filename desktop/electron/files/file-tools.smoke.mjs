import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import assert from "node:assert/strict";
import { executeFileTool } from "../../dist-electron/files/file-tools.js";

const root = await mkdtemp(join(tmpdir(), "ohmycode-files-"));
await writeFile(join(root, "AGENTS.md"), "root rules", "utf8");
await writeFile(join(root, "demo.txt"), "alpha\nbeta\n", "utf8");
await writeFile(join(root, "many.txt"), `${Array.from({ length: 80 }, (_, index) => `match ${index}`).join("\n")}\n`, "utf8");

const inspectedPaths = new Set();
const searchDirectory = join(root, "src", "shared", "i18n");
await mkdir(searchDirectory, { recursive: true });
const dictionary = join(searchDirectory, "dictionaries.ts");
await writeFile(dictionary, 'export const greeting = "Hello";\n', "utf8");
const searchFile = (options) => executeFileTool("search_files", { projectId: "test", ...options }, root);
for (const target of ["src/shared/i18n/dictionaries.ts", dictionary]) {
  const found = await searchFile({ path: target, query: "HELLO" });
  assert.equal(found.pathKind, "file");
  assert.equal(found.path, await realpath(dictionary));
  assert.equal(found.totalMatches, 1);
  assert.match(found.output, /dictionaries\.ts:1: export const greeting/);
}
const fileName = await searchFile({ path: dictionary, query: "DICTIONARIES.TS", mode: "files" });
assert.equal(fileName.returnedMatches, 1);
assert.equal(fileName.output, await realpath(dictionary));
for (const options of [
  { path: dictionary, query: "absent" },
  { path: dictionary, query: "Hello", glob: "**/*.json" },
  { path: dictionary, query: "absent", mode: "files" },
]) {
  const empty = await searchFile(options);
  assert.equal(empty.pathKind, "file");
  assert.equal(empty.output, "");
  assert.equal(empty.totalMatches, 0);
  assert.equal(empty.truncated, false);
}
assert.equal((await searchFile({ path: dictionary, query: "Hello", glob: "**/*.ts" })).returnedMatches, 1);
const workspaceSearch = await searchFile({ query: "Hello" });
assert.equal(workspaceSearch.pathKind, "directory");
assert.equal(workspaceSearch.returnedMatches, 1);
assert.equal((await searchFile({ path: "src/shared", query: "Hello" })).returnedMatches, 1);
await assert.rejects(searchFile({ path: dictionary, query: "" }), /^Error: query_required$/);
await assert.rejects(searchFile({ path: "missing.ts", query: "Hello" }), /^Error: path_not_found$/);
await assert.rejects(searchFile({ path: join(dictionary, "child"), query: "Hello" }), /^Error: (not_a_directory|path_not_found)$/);
await assert.rejects(searchFile({ path: "..", query: "Hello" }), /path_outside_workspace/);
const outsideRoot = await mkdtemp(join(tmpdir(), "ohmycode-search-outside-"));
const outsideFile = join(outsideRoot, "outside.txt");
await writeFile(outsideFile, "Hello", "utf8");
await assert.rejects(searchFile({ path: outsideFile, query: "Hello" }), /path_outside_workspace/);
await assert.rejects(executeFileTool("list_directory", { projectId: "test", path: dictionary }, root), /not_a_directory/);
await writeFile(join(root, "binary.bin"), Buffer.from([0, 72, 101, 108, 108, 111]));
assert.equal((await searchFile({ path: "binary.bin", query: "Hello" })).returnedMatches, 0);
await writeFile(join(root, "limits.txt"), Array.from({ length: 205 }, () => "limit-token").join("\n"));
const limitedFile = await searchFile({ path: "limits.txt", query: "limit-token", maxResults: 500, maxChars: 32000 });
assert.equal(limitedFile.pathKind, "file");
assert.equal(limitedFile.returnedMatches, 200);
assert.equal(limitedFile.totalMatches, 205);
assert.equal(limitedFile.truncated, true);
const limitedChars = await searchFile({ path: "limits.txt", query: "limit-token", maxChars: 120 });
assert.ok(limitedChars.output.length <= 120);
assert.equal(limitedChars.totalMatches, 205);
assert.equal(limitedChars.truncated, true);
const read = await executeFileTool("read_file", { projectId: "test", path: "demo.txt" }, root, inspectedPaths);
inspectedPaths.add(read.path);
const search = await executeFileTool(
  "search_files",
  { projectId: "test", path: ".", query: "beta", mode: "content" },
  root,
  inspectedPaths,
);
const listing = await executeFileTool(
  "list_directory",
  { projectId: "test", path: "." },
  root,
  inspectedPaths,
);
const boundedSearch = await executeFileTool(
  "search_files",
  { projectId: "test", path: ".", query: "match", mode: "content", maxChars: 120 },
  root,
  inspectedPaths,
);
let rejectedUninspectedEdit = false;
try {
  await executeFileTool(
    "apply_patch",
    {
      projectId: "test",
      patch: "*** Begin Patch\n*** Update File: AGENTS.md\n@@\n-root rules\n+changed rules\n*** End Patch",
    },
    root,
    inspectedPaths,
  );
} catch (error) {
  rejectedUninspectedEdit = error instanceof Error && error.message.startsWith("inspection_required:");
}
const patch = await executeFileTool(
  "apply_patch",
  {
    projectId: "test",
    patch: "*** Begin Patch\n*** Update File: demo.txt\n@@\n-alpha\n+gamma\n beta\n*** End Patch",
  },
  root,
  inspectedPaths,
);
const value = await readFile(join(root, "demo.txt"), "utf8");

for (const patch of [
  "*** Begin Patch\n*** Update File: demo.txt\n@@\n-gamma\n+bad",
  "*** Begin Patch\n*** Update File: demo.txt\n-gamma\n+bad\n*** End Patch",
  "*** Begin Patch\n*** Add File: bad.txt\nunprefixed content\n*** End Patch",
  "*** Begin Patch\n*** Delete File: demo.txt\nunexpected content\n*** End Patch",
]) {
  await assert.rejects(executeFileTool("apply_patch", { projectId: "test", patch }, root, inspectedPaths), /invalid_patch/);
}
assert.equal(await readFile(join(root, "demo.txt"), "utf8"), value);
await writeFile(join(root, "repeated.txt"), "same\nsame\n", "utf8");
const repeated = await executeFileTool("read_file", { projectId: "test", path: "repeated.txt" }, root);
inspectedPaths.add(repeated.path);
await assert.rejects(executeFileTool("apply_patch", {
  projectId: "test", patch: "*** Begin Patch\n*** Update File: repeated.txt\n@@\n-same\n+changed\n*** End Patch",
}, root, inspectedPaths), /patch_context_ambiguous/);
assert.equal(await readFile(join(root, "repeated.txt"), "utf8"), "same\nsame\n");

if (!search.output.includes("demo.txt:2")) throw new Error("Content search did not return the expected match");
if (!listing.output.includes("file\tdemo.txt")) throw new Error("Directory listing omitted the test file");
if (!boundedSearch.truncated || boundedSearch.output.length > 120) throw new Error("Search output character limit was not enforced");
if (boundedSearch.totalMatches !== 80 || boundedSearch.returnedMatches >= 80) throw new Error("Search truncation metadata is inaccurate");
if (!rejectedUninspectedEdit) throw new Error("Patch accepted an existing file that was not read first");
if (value !== "gamma\nbeta\n") throw new Error("Patch did not produce the expected file content");
if (!patch.affectedPaths?.includes(join(await realpath(root), "demo.txt"))) throw new Error("Patch did not report the affected path");
if (patch.changes?.[0]?.original !== "alpha\nbeta\n" || patch.changes?.[0]?.modified !== "gamma\nbeta\n") throw new Error("Patch did not preserve before/after content");

process.stdout.write("File tools smoke test passed\n");
