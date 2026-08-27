import { BrowserWindow, ipcMain } from "electron";
import { deleteMcpServer, listMcpServers, saveMcpServer, testMcpServer } from "../capabilities/mcp-manager.js";
import type { McpServerInput } from "../capabilities/types.js";
import { deleteSkill, downloadSkill, installSkill, listSkills, removeLocalSkill } from "../capabilities/skill-manager.js";

export function registerCapabilitiesIpc(): void {
  const publishChanged = () => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("capabilities:changed");
    }
  };
  ipcMain.handle("capabilities:mcp-list", listMcpServers);
  ipcMain.handle("capabilities:mcp-save", async (_event, input: McpServerInput) => {
    const saved = await saveMcpServer(input);
    publishChanged();
    if (saved.enabled) {
      // MCP transports belong to Electron because stdio servers run on this device.
      // Refresh tools in the background so saving settings never waits on a remote handshake.
      void testMcpServer(saved.id).catch(() => undefined).finally(publishChanged);
    }
    return saved;
  });
  ipcMain.handle("capabilities:mcp-test", async (_event, id: string) => {
    try {
      return await testMcpServer(id);
    } finally {
      publishChanged();
    }
  });
  ipcMain.handle("capabilities:mcp-delete", async (_event, id: string) => {
    await deleteMcpServer(id);
    publishChanged();
  });
  ipcMain.handle("capabilities:skills-list", listSkills);
  ipcMain.handle("capabilities:skills-install", async () => {
    const result = await installSkill();
    if (result) publishChanged();
    return result;
  });
  ipcMain.handle("capabilities:skills-download", async (_event, id: string) => {
    const result = await downloadSkill(id);
    publishChanged();
    return result;
  });
  ipcMain.handle("capabilities:skills-remove-local", async (_event, name: string) => {
    await removeLocalSkill(name);
    publishChanged();
  });
  ipcMain.handle("capabilities:skills-delete", async (_event, id: string, name: string) => {
    await deleteSkill(id, name);
    publishChanged();
  });
}
