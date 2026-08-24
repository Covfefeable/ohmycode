import { ipcMain } from "electron";
import { executeTerminalAction } from "../terminal/terminal-manager.js";
import type { TerminalAction } from "../terminal/types.js";

export function registerTerminalIpc(): void {
  ipcMain.handle("terminal:execute", (_event, action: TerminalAction) => executeTerminalAction(action));
}
