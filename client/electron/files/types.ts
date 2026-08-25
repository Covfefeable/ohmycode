export type FileToolName = "read_file" | "search_files" | "list_directory" | "apply_patch";

export type FileToolRequest = {
  projectId: string;
  path?: string;
  query?: string;
  mode?: "content" | "files";
  glob?: string;
  startLine?: number;
  endLine?: number;
  maxBytes?: number;
  maxResults?: number;
  maxEntries?: number;
  depth?: number;
  includeHidden?: boolean;
  patch?: string;
};

export type FileToolResult = {
  operation: FileToolName;
  path: string;
  pathKind: "file" | "directory";
  output: string;
  truncated?: boolean;
  affectedPaths?: string[];
  agentInstructions?: Array<{ path: string; content: string }>;
};
