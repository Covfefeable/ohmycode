import type { ToolDefinition } from "@ohmycode/tool-contracts";

export const FILE_DEFINITIONS: ToolDefinition[] = [
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
    description: "Search workspace file names or UTF-8 file contents.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" }, path: { type: "string" }, mode: { type: "string", enum: ["content", "files"] },
        glob: { type: "string" }, maxResults: { type: "integer", minimum: 1, maximum: 500 },
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

export const TERMINAL_DEFINITION: ToolDefinition = {
  name: "terminal",
  description: "Start, inspect, interact with, stop, or list persistent local terminals.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "read", "write", "stop", "list"] },
      command: { type: "string" }, cwd: { type: "string" }, terminalId: { type: "string" },
      afterCursor: { type: "integer" }, yieldMs: { type: "integer", minimum: 0, maximum: 30000 },
      input: { type: "string" }, intent: { type: "string", enum: ["read", "write"] },
    },
    required: ["action"],
  },
};

export const VIEW_IMAGE_DEFINITION: ToolDefinition = {
  name: "view_image",
  description: "View a local or remote image and attach it to the model conversation.",
  inputSchema: {
    type: "object",
    properties: { imageUrl: { type: "string" }, detail: { type: "string", enum: ["low", "high"] } },
    required: ["imageUrl"],
  },
};

export const AGENT_MESSAGE_DEFINITION: ToolDefinition = {
  name: "agent_message",
  description: "Post a group-chat message and hand the active turn to another collaboration member.",
  inputSchema: {
    type: "object", properties: { toNodeId: { type: "string" }, content: { type: "string" } },
    required: ["toNodeId", "content"],
  },
};

export const FINISH_COLLABORATION_DEFINITION: ToolDefinition = {
  name: "finish_collaboration",
  description: "Host only: end the collaboration and publish the final answer.",
  inputSchema: {
    type: "object", properties: { content: { type: "string" } }, required: ["content"],
  },
};
