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
