import { ipcMain } from "electron";
import { deleteMcpServer, listMcpServers, saveMcpServer, testMcpServer } from "../capabilities/mcp-manager.js";
import type { McpServerInput } from "../capabilities/types.js";
import { deleteSkill, downloadSkill, installSkill, listSkills, removeLocalSkill } from "../capabilities/skill-manager.js";

export function registerCapabilitiesIpc(): void {
  ipcMain.handle("capabilities:mcp-list", listMcpServers);
  ipcMain.handle("capabilities:mcp-save", (_event, input: McpServerInput) => saveMcpServer(input));
  ipcMain.handle("capabilities:mcp-test", (_event, id: string) => testMcpServer(id));
  ipcMain.handle("capabilities:mcp-delete", (_event, id: string) => deleteMcpServer(id));
  ipcMain.handle("capabilities:skills-list", listSkills);
  ipcMain.handle("capabilities:skills-install", installSkill);
  ipcMain.handle("capabilities:skills-download", (_event, id: string) => downloadSkill(id));
  ipcMain.handle("capabilities:skills-remove-local", (_event, name: string) => removeLocalSkill(name));
  ipcMain.handle("capabilities:skills-delete", (_event, id: string, name: string) => deleteSkill(id, name));
}
