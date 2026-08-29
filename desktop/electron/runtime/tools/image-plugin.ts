import { defineToolPlugin } from "@ohmycode/agent-runtime";
import type { ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { executeViewImage, type ViewImageArguments } from "../../files/image-tool.js";

const VIEW_IMAGE_DEFINITION: ToolDefinition = {
  name: "view_image",
  description: "View a local or remote image and attach it to the model conversation.",
  inputSchema: {
    type: "object",
    properties: { imageUrl: { type: "string" }, detail: { type: "string", enum: ["low", "high"] } },
    required: ["imageUrl"],
  },
};

export function createImagePlugin(options: {
  projectId: string;
  workspaceRoot?: string;
  attachmentPaths: Set<string>;
}): ToolPlugin {
  return defineToolPlugin({
    id: "image",
    definitions: [VIEW_IMAGE_DEFINITION],
    execute: (call) => executeViewImage(
      { ...(call.arguments as ViewImageArguments), projectId: options.projectId },
      options.workspaceRoot,
      options.attachmentPaths,
    ),
  });
}
