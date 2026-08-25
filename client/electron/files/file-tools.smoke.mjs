import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { executeFileTool } from "../../dist-electron/files/file-tools.js";

const root = await mkdtemp(join(tmpdir(), "ohmycode-files-"));
await writeFile(join(root, "AGENTS.md"), "root rules", "utf8");
await writeFile(join(root, "demo.txt"), "alpha\nbeta\n", "utf8");

const inspectedPaths = new Set();
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

if (!read.agentInstructions?.length) throw new Error("AGENTS.md hierarchy was not loaded");
if (!search.output.includes("demo.txt:2")) throw new Error("Content search did not return the expected match");
if (!listing.output.includes("file\tdemo.txt")) throw new Error("Directory listing omitted the test file");
if (!rejectedUninspectedEdit) throw new Error("Patch accepted an existing file that was not read first");
if (value !== "gamma\nbeta\n") throw new Error("Patch did not produce the expected file content");
if (!patch.affectedPaths?.includes(join(root, "demo.txt"))) throw new Error("Patch did not report the affected path");

process.stdout.write("File tools smoke test passed\n");
