export type ToolPresentation = {
  kind: "file" | "terminal" | "generic";
  icon?: "file" | "edit" | "search" | "directory" | "image";
  labels?: {
    running: string;
    completed: string;
    failed: string;
  };
  viewer?: "file-content" | "file-diff";
};

export type FileChange = {
  path: string;
  original?: string;
  modified?: string;
  diffUnavailable?: "file_too_large";
};

export type ToolActivityPresentation = ToolPresentation & {
  action: string;
  changes: FileChange[];
  command: string;
  displayResource: string;
  failed: boolean;
  input: Record<string, unknown>;
  projectId?: string;
  resource: string;
  result: string;
};

const FILE_PRESENTATIONS: Record<string, ToolPresentation> = {
  read_file: {
    kind: "file",
    icon: "file",
    labels: { running: "agent.readingFile", completed: "agent.readFile", failed: "agent.readFileFailed" },
    viewer: "file-content",
  },
  apply_patch: {
    kind: "file",
    icon: "edit",
    labels: { running: "agent.editingFile", completed: "agent.editedFile", failed: "agent.editFileFailed" },
    viewer: "file-diff",
  },
  search_files: {
    kind: "file",
    icon: "search",
    labels: { running: "agent.searchingFiles", completed: "agent.searchedFiles", failed: "agent.searchFilesFailed" },
  },
  list_directory: {
    kind: "file",
    icon: "directory",
    labels: { running: "agent.listingDirectory", completed: "agent.listedDirectory", failed: "agent.listDirectoryFailed" },
  },
  view_image: {
    kind: "file",
    icon: "image",
    labels: { running: "agent.viewingImage", completed: "agent.viewedImage", failed: "agent.viewImageFailed" },
  },
};

export function toolPresentation(toolName: string): ToolPresentation {
  if (toolName === "terminal") return { kind: "terminal" };
  return FILE_PRESENTATIONS[toolName] ?? { kind: "generic" };
}

function record(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resultText(value: unknown): string {
  const result = record(value);
  if (typeof result.dataUrl === "string") {
    return JSON.stringify(Object.fromEntries(Object.entries(result).filter(([key]) => key !== "dataUrl")), null, 2);
  }
  if (typeof result.operation === "string" && typeof result.output === "string") return result.output;
  if (typeof result.output === "string") {
    const suffix = result.status === "running"
      ? `\n\n[${String(result.status)} · terminal ${String(result.terminalId || "")}]`
      : `\n\n[exit ${String(result.exitCode ?? "-")}]`;
    return `${result.output}${suffix}`.trim();
  }
  return value ? JSON.stringify(value, null, 2) : "";
}

function failed(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(failed);
  const result = record(value);
  return typeof result.error === "string"
    || (typeof result.exitCode === "number" && result.exitCode !== 0);
}

function patchTarget(value: unknown): string {
  return typeof value === "string"
    ? value.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/m)?.[1]?.trim() ?? ""
    : "";
}

function resourceName(value: string): string {
  const normalized = value.replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).at(-1) || value;
}

export function presentToolActivity(toolName: string, rawInput: unknown, rawResult: unknown): ToolActivityPresentation {
  const input = record(rawInput);
  const result = record(rawResult);
  const action = String(input.action || (input.command ? "start" : toolName));
  const requestedResource = typeof input.path === "string" ? input.path : patchTarget(input.patch);
  const resource = (typeof result.path === "string" ? result.path : "") || requestedResource;
  const imageReference = typeof input.imageUrl === "string" ? input.imageUrl : "";
  const changes = Array.isArray(result.changes)
    ? result.changes.filter((item): item is FileChange => Boolean(item && typeof item === "object" && typeof (item as { path?: unknown }).path === "string"))
    : [];
  return {
    ...toolPresentation(toolName),
    action,
    changes,
    command: input.command ? String(input.command) : `${action} ${String(input.terminalId || "")}`.trim(),
    displayResource: resourceName(resource || imageReference),
    failed: failed(rawResult),
    input,
    projectId: typeof input.projectId === "string" ? input.projectId : undefined,
    resource,
    result: resultText(rawResult),
  };
}
