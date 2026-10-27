import { handleInvoke } from "./handle-invoke.js";
import { checkForDesktopUpdate, openDesktopReleases } from "../updates/github-release-service.js";

export function registerUpdateIpc(): void {
  handleInvoke("updates:check", checkForDesktopUpdate);
  handleInvoke("updates:open-download", openDesktopReleases);
}
