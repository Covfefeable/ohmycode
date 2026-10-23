import { ipcMain } from "electron";
import { openLocalPath } from "../files/open-path.js";
import { previewWorkspaceImage, type ImageScope } from "../files/image-preview.js";
import { savePastedImage } from "../files/pasted-image.js";

export function registerFilesIpc(): void {
  ipcMain.handle("images:preview", (_event, scope: ImageScope | undefined, reference: string) => previewWorkspaceImage(scope, reference));
  ipcMain.handle("system:open-path", (_event, targetPath: string, projectId?: string) => openLocalPath(targetPath, projectId));
  ipcMain.handle("conversations:save-pasted-image", (_event, data: Uint8Array) => savePastedImage(data));
}
