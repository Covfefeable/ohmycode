import { ipcMain, type IpcMainInvokeEvent } from "electron";
import type { DesktopInvocations } from "../../contracts/invocations.js";

/** Compile-time agreement with preload; existing handlers still validate IPC input. */
export function handleInvoke<K extends keyof DesktopInvocations>(
  channel: K,
  handler: (event: IpcMainInvokeEvent, ...args: Parameters<DesktopInvocations[K]>) => ReturnType<DesktopInvocations[K]> | Awaited<ReturnType<DesktopInvocations[K]>>,
): void {
  ipcMain.handle(channel, handler);
}
