import { defineToolPlugin } from "@ohmycode/agent-runtime";
import type { ToolCall, ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { executeFileTool, MAX_SEARCH_RESULTS } from "../../files/file-tools.js";
import type { FileToolName, FileToolRequest } from "../../files/types.js";
import { acquireWorkspaceWriteLock } from "../../multi-agents/workspace-write-lock.js";
import { recordWorkspaceChanges, snapshotWorkspace } from "../../multi-agents/workspace-changes.js";
import type { DesktopExecutionContext } from "../types.js";

const FILE_DEFINITIONS: ToolDefinition[] = [
  {
    name: "read_file",
    description: "Read a UTF-8 text file with line numbers. Inspect relevant files before editing them.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }, startLine: { type: "integer", minimum: 1 },
        endLine: { type: "integer", minimum: 1 }, maxBytes: { type: "integer", minimum: 1, maximum: 262144 },
      },
      required: ["path"],
    },
  },
  {
    name: "search_files",
    description: "Search a workspace file or recursively search a directory for file paths or UTF-8 content. Matches are case-insensitive literal text, not regular expressions.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", minLength: 1, description: "Non-empty literal text to find." },
        path: { type: "string", default: ".", description: "Existing file or directory inside the workspace, absolute or workspace-relative. A file limits search to that file; a directory is searched recursively. Defaults to the workspace root." },
        mode: { type: "string", enum: ["content", "files"], default: "content", description: "content searches file contents and returns matching lines; files matches workspace-relative file paths." },
        glob: { type: "string", description: "Optional glob filter matched against slash-separated workspace-relative file paths, including when path is a single file." },
        includeHidden: { type: "boolean", default: false, description: "Include hidden entries when searching a directory." },
        maxResults: { type: "integer", minimum: 1, maximum: MAX_SEARCH_RESULTS, default: 50 },
        maxChars: { type: "integer", minimum: 1, maximum: 32000, default: 8000 },
      },
      required: ["query"],
    },
  },
  {
    name: "list_directory",
    description: "List files and directories in the workspace with bounded depth and result count.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" }, depth: { type: "integer", minimum: 1, maximum: 5 },
        includeHidden: { type: "boolean" }, maxEntries: { type: "integer", minimum: 1, maximum: 1000 },
      },
    },
  },
  {
    name: "apply_patch",
    description: "Apply a strict patch envelope inside the workspace. Read every existing target file first.",
    inputSchema: {
      type: "object", properties: { patch: { type: "string" } }, required: ["patch"],
    },
  },
];

export function createFilePlugin(options: {
  projectId: string;
  workspaceRoot?: string;
  executionContext?: DesktopExecutionContext;
  attachmentPaths: Set<string>;
}): ToolPlugin {
  const inspectedPaths = new Set<string>();
  return defineToolPlugin({
    id: "files",
    definitions: FILE_DEFINITIONS,
    execute: async (call: ToolCall) => {
      let release: (() => void) | undefined;
      if (options.executionContext && call.tool === "apply_patch") {
        const unlock = await acquireWorkspaceWriteLock(
          options.executionContext.workspacePath,
          options.executionContext.ownerId,
        );
        const before = snapshotWorkspace(options.executionContext.workspacePath);
        release = () => {
          void recordWorkspaceChanges(
            options.executionContext!.ownerId,
            options.executionContext!.workspacePath,
            before,
          ).finally(unlock);
        };
      }
      try {
        const result = await executeFileTool(
          call.tool as FileToolName,
          { ...(call.arguments as FileToolRequest), projectId: options.projectId },
          options.workspaceRoot,
          inspectedPaths,
          options.attachmentPaths,
        );
        if (call.tool === "read_file") inspectedPaths.add(result.path);
        release?.();
        return result;
      } catch (error) {
        release?.();
        throw error;
      }
    },
  });
}
