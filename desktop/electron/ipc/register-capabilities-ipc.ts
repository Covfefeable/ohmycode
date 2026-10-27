import { handleInvoke } from "./handle-invoke.js";
import { BrowserWindow } from "electron";
import { deleteMcpServer, listMcpServers, saveMcpServer, testMcpServer } from "../capabilities/mcp-manager.js";
import type { McpServerInput } from "../../contracts/domain.js";
import { deleteSkill, downloadSkill, installSkill, listSkills, removeLocalSkill } from "../capabilities/skill-manager.js";

export function registerCapabilitiesIpc(): void {
  const publishChanged = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("capabilities:changed");
    }
  };
  handleInvoke("capabilities:mcp-list", listMcpServers);
  handleInvoke("capabilities:mcp-save", async (_event, input: McpServerInput) => {
    const saved = await saveMcpServer(input);
    publishChanged();
    if (saved.enabled) {
      // MCP transports belong to Electron because stdio servers run on this device.
      // Refresh tools in the background so saving settings never waits on a remote handshake.
      void testMcpServer(saved.id).catch(() => undefined).finally(publishChanged);
    }
    return saved;
  });
  handleInvoke("capabilities:mcp-test", async (_event, id: string) => {
    try {
      return await testMcpServer(id);
    } finally {
      publishChanged();
    }
  });
  handleInvoke("capabilities:mcp-delete", async (_event, id: string) => {
    await deleteMcpServer(id);
    publishChanged();
  });
  handleInvoke("capabilities:skills-list", listSkills);
  handleInvoke("capabilities:skills-install", async () => {
    const result = await installSkill();
    if (result) publishChanged();
    return result;
  });
  handleInvoke("capabilities:skills-download", async (_event, id: string) => {
    const result = await downloadSkill(id);
    publishChanged();
    return result;
  });
  handleInvoke("capabilities:skills-remove-local", async (_event, id: string) => {
    await removeLocalSkill(id);
    publishChanged();
  });
  handleInvoke("capabilities:skills-delete", async (_event, id: string) => {
    await deleteSkill(id);
    publishChanged();
  });
}
