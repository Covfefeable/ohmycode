import { handleInvoke } from "./handle-invoke.js";
import { openLocalPath } from "../files/open-path.js";
import { previewWorkspaceImage } from "../files/image-preview.js";
import type { ImageScope } from "../../contracts/domain.js";
import { savePastedImage } from "../files/pasted-image.js";

export function registerFilesIpc(): void {
  handleInvoke("images:preview", (_event, scope: ImageScope | undefined, reference: string) => previewWorkspaceImage(scope, reference));
  handleInvoke("system:open-path", (_event, targetPath: string, projectId?: string) => openLocalPath(targetPath, projectId));
  handleInvoke("conversations:save-pasted-image", (_event, data: Uint8Array) => savePastedImage(data));
}
