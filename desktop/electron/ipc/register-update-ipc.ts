import { ipcMain } from "electron";
import { checkForDesktopUpdate, openDesktopReleases } from "../updates/github-release-service.js";

export function registerUpdateIpc(): void {
  ipcMain.handle("updates:check", checkForDesktopUpdate);
  ipcMain.handle("updates:open-download", openDesktopReleases);
}
