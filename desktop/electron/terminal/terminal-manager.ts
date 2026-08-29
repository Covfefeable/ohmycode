import path from "node:path";
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import * as pty from "node-pty";
import { listProjects } from "../projects/projects-service.js";
import { commandRequiresApproval } from "./command-policy.js";
import { TERMINAL_CONFIG } from "./config.js";
import { shellLaunch } from "./platform.js";
import { ensureNodePtyHelperExecutable } from "./node-pty-helper.js";
import type { TerminalAction, TerminalResult, TerminalStatus } from "./types.js";

type Session = {
  id: string;
  projectId: string;
  command: string;
  cwd: string;
  process: pty.IPty;
  status: TerminalStatus;
  output: string;
  baseCursor: number;
  cursor: number;
  exitCode?: number;
  exitHandlers: Set<() => void>;
};

const sessions = new Map<string, Session>();

function boundedYield(value: number | undefined): number {
  return Math.max(0, Math.min(value ?? TERMINAL_CONFIG.defaultYieldMs, TERMINAL_CONFIG.maximumYieldMs));
}

function appendOutput(session: Session, data: string): void {
  session.output += data;
  session.cursor += data.length;
  if (session.output.length > TERMINAL_CONFIG.bufferLength) {
    const removed = session.output.length - TERMINAL_CONFIG.bufferLength;
    session.output = session.output.slice(removed);
    session.baseCursor += removed;
  }
}

function normalizeTerminalInput(input: string): string {
  // PTY applications treat carriage return as the Enter key. Models and JSON
  // clients generally send line feeds, which works for line-oriented shells
  // but does not confirm selections in interactive TUIs (for example prompts
  // from create-vite). Keep explicit control sequences intact while making
  // newline input behave like a real terminal Enter key on every platform.
  return input.replace(/\r\n|\n/g, "\r");
}

function snapshot(session: Session, afterCursor = 0): TerminalResult {
  const start = Math.max(0, afterCursor - session.baseCursor);
  let output = stripVTControlCharacters(session.output.slice(start));
  const resultTruncated = output.length > TERMINAL_CONFIG.resultLength;
  if (resultTruncated) {
    const tailLength = TERMINAL_CONFIG.resultLength - TERMINAL_CONFIG.resultHeadLength;
    output = `${output.slice(0, TERMINAL_CONFIG.resultHeadLength)}\n\n[output truncated]\n\n${output.slice(-tailLength)}`;
  }
  return {
    terminalId: session.id,
    command: session.command,
    cwd: session.cwd,
    status: session.status,
    cursor: session.cursor,
    output,
    truncated: afterCursor < session.baseCursor || resultTruncated,
    exitCode: session.exitCode,
  };
}

async function waitForExitOrTimeout(session: Session, yieldMs: number, signal?: AbortSignal): Promise<void> {
  if (session.status !== "running" || yieldMs === 0) return;
  await new Promise<void>((resolve) => {
    const timer = setTimeout(done, yieldMs);
    const disposable = session.process.onExit(done);
    signal?.addEventListener("abort", done, { once: true });
    function done() {
      clearTimeout(timer);
      disposable.dispose();
      signal?.removeEventListener("abort", done);
      resolve();
    }
  });
}

async function projectDirectory(projectId: string, requestedCwd?: string, workspaceRoot?: string): Promise<string> {
  if (workspaceRoot) {
    const root = path.resolve(workspaceRoot);
    const cwd = path.resolve(root, requestedCwd || ".");
    const relative = path.relative(root, cwd);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("cwd_outside_workspace");
    return cwd;
  }
  const project = (await listProjects()).find((item) => item.id === projectId);
  if (!project) throw new Error("project_not_found");
  const root = path.resolve(project.path);
  const cwd = path.resolve(root, requestedCwd || ".");
  const relative = path.relative(root, cwd);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("cwd_outside_workspace");
  return cwd;
}

async function start(action: Extract<TerminalAction, { action: "start" }>, signal?: AbortSignal, workspaceRoot?: string): Promise<TerminalResult> {
  const command = action.command.trim();
  if (!command) throw new Error("command_required");
  if (commandRequiresApproval(command)) {
    throw new Error("command_requires_approval");
  }
  const cwd = await projectDirectory(action.projectId, action.cwd, workspaceRoot);
  const launch = shellLaunch(command);
  ensureNodePtyHelperExecutable();
  const child = pty.spawn(launch.executable, launch.args, {
    cwd,
    cols: TERMINAL_CONFIG.columns,
    rows: TERMINAL_CONFIG.rows,
    name: "xterm-256color",
    env: Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")),
    ...(process.platform === "win32" ? { useConptyDll: true } : {}),
  });
  const session: Session = {
    id: randomUUID(), projectId: action.projectId, command, cwd, process: child,
    status: "running", output: "", baseCursor: 0, cursor: 0, exitHandlers: new Set(),
  };
  sessions.set(session.id, session);
  child.onData((data) => appendOutput(session, data));
  child.onExit(({ exitCode }) => {
    session.status = session.status === "stopped" ? "stopped" : "exited";
    session.exitCode = exitCode;
    for (const handler of session.exitHandlers) handler();
    session.exitHandlers.clear();
  });
  await waitForExitOrTimeout(session, boundedYield(action.yieldMs), signal);
  if (signal?.aborted && session.status === "running") {
    session.status = "stopped";
    session.process.kill();
  }
  return snapshot(session);
}

export function onTerminalExit(terminalId: string, handler: () => void): () => void {
  const session = sessions.get(terminalId);
  if (!session || session.status !== "running") {
    handler();
    return () => undefined;
  }
  session.exitHandlers.add(handler);
  return () => session.exitHandlers.delete(handler);
}

export async function executeTerminalAction(action: TerminalAction, signal?: AbortSignal, workspaceRoot?: string): Promise<TerminalResult | TerminalResult[]> {
  if (action.action === "start") return start(action, signal, workspaceRoot);
  if (action.action === "list") {
    return [...sessions.values()]
      .filter((session) => !action.projectId || session.projectId === action.projectId)
      .map((session) => snapshot(session, session.cursor));
  }
  const session = sessions.get(action.terminalId);
  if (!session) throw new Error("terminal_not_found");
  if (action.action === "write") {
    if (session.status !== "running") throw new Error("terminal_not_running");
    session.process.write(normalizeTerminalInput(action.input));
    return snapshot(session, session.cursor);
  }
  if (action.action === "stop") {
    if (session.status === "running") {
      session.status = "stopped";
      session.process.kill();
    }
    return snapshot(session, session.cursor);
  }
  const afterCursor = action.afterCursor
    ?? (session.status === "running" ? session.cursor : 0);
  await waitForExitOrTimeout(session, boundedYield(action.yieldMs), signal);
  return snapshot(session, afterCursor);
}

export function stopAllTerminals(): void {
  for (const session of sessions.values()) {
    if (session.status === "running") {
      session.status = "stopped";
      session.process.kill();
    }
  }
}
