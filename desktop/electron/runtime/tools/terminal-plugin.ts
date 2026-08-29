import { defineToolPlugin } from "@ohmycode/agent-runtime";
import type { ToolDefinition, ToolPlugin } from "@ohmycode/tool-contracts";
import { acquireWorkspaceWriteLock } from "../../multi-agents/workspace-write-lock.js";
import { recordWorkspaceChanges, snapshotWorkspace } from "../../multi-agents/workspace-changes.js";
import { executeTerminalAction, onTerminalExit } from "../../terminal/terminal-manager.js";
import type { TerminalAction } from "../../terminal/types.js";
import type { DesktopTurnExecution } from "../desktop-execution-adapter.js";
import type { DesktopExecutionContext } from "../types.js";

const terminalWriteLeases = new Map<string, () => void>();
const TERMINAL_DEFINITION: ToolDefinition = {
  name: "terminal",
  description: "Start, inspect, interact with, stop, or list persistent local terminals.",
  inputSchema: {
    type: "object",
    properties: {
      action: { type: "string", enum: ["start", "read", "write", "stop", "list"] },
      command: { type: "string" }, cwd: { type: "string" }, terminalId: { type: "string" },
      afterCursor: { type: "integer" }, yieldMs: { type: "integer", minimum: 0, maximum: 30000 },
      input: { type: "string" }, intent: { type: "string", enum: ["read", "write"] },
    },
    required: ["action"],
  },
};

export function createTerminalPlugin(options: {
  execution: DesktopTurnExecution;
  projectId: string;
  workspaceRoot?: string;
  executionContext?: DesktopExecutionContext;
}): ToolPlugin {
  return defineToolPlugin({
    id: "terminal",
    definitions: [TERMINAL_DEFINITION],
    execute: async (call) => {
      const action = call.arguments as Record<string, unknown>;
      const actionName = typeof action.action === "string"
        ? action.action
        : action.command
          ? "start"
          : action.terminalId && "input" in action
            ? "write"
            : action.terminalId ? "read" : "list";
      const normalized = { ...action, action: actionName, projectId: options.projectId } as TerminalAction;
      let release: (() => void) | undefined;
      if (options.executionContext && normalized.action === "start" && normalized.intent !== "read") {
        const unlock = await acquireWorkspaceWriteLock(
          options.executionContext.workspacePath,
          options.executionContext.ownerId,
        );
        const before = snapshotWorkspace(options.executionContext.workspacePath);
        release = () => {
          void recordWorkspaceChanges(
            options.executionContext!.ownerId,
            options.executionContext!.workspacePath,
            before,
          ).finally(unlock);
        };
      }
      let result;
      try {
        result = await executeTerminalAction(
          normalized,
          options.execution.signal,
          options.workspaceRoot,
        );
      } catch (error) {
        release?.();
        throw error;
      }
      const items = Array.isArray(result) ? result : [result];
      if (normalized.action === "start") {
        for (const item of items) {
          if (item.terminalId) options.execution.registerResource(item.terminalId);
        }
      }
      if (release) {
        const running = items.find((item) => item.status === "running");
        if (running) {
          terminalWriteLeases.set(running.terminalId, release);
          onTerminalExit(running.terminalId, () => {
            terminalWriteLeases.get(running.terminalId)?.();
            terminalWriteLeases.delete(running.terminalId);
          });
        } else {
          release();
        }
      }
      for (const item of items) {
        if (item.status !== "running") {
          terminalWriteLeases.get(item.terminalId)?.();
          terminalWriteLeases.delete(item.terminalId);
        }
      }
      return result;
    },
  });
}
