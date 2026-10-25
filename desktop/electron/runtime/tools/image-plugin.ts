import { defineToolPlugin } from "@ohmycode/agent-runtime";
import type { ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { executeViewImage, type ViewImageArguments } from "../../files/image-tool.js";
import { viewImageAsset } from "../../files/image-assets.js";

const VIEW_IMAGE_DEFINITION: ToolDefinition = {
  name: "view_image",
  description: "View a local image, public image URL, or an ohmycode-image:// reference from an earlier tool result. Reattaches the image to the model conversation when older visual content has been omitted. Stored references are checked through the authenticated image API.",
  inputSchema: {
    type: "object",
    properties: { imageUrl: { type: "string" }, detail: { type: "string", enum: ["low", "high"] } },
    required: ["imageUrl"],
  },
};

export function createImagePlugin(options: {
  projectId: string;
  workspaceRoot?: string;
}): ToolPlugin {
  return defineToolPlugin({
    id: "image",
    definitions: [VIEW_IMAGE_DEFINITION],
    execute: (call) => {
      const args = { ...(call.arguments as ViewImageArguments), projectId: options.projectId };
      const imageUrl = String(args.imageUrl ?? "").trim();
      if (imageUrl.startsWith("ohmycode-image://")) return viewImageAsset(imageUrl, args.detail);
      return executeViewImage(args, options.workspaceRoot);
    },
  });
}
