export type TerminalStatus = "running" | "exited" | "stopped";

export type TerminalResult = {
  terminalId: string;
  command: string;
  cwd: string;
  status: TerminalStatus;
  cursor: number;
  output: string;
  truncated?: boolean;
  exitCode?: number;
};

export type TerminalAction =
  | { action: "start"; projectId: string; command: string; cwd?: string; yieldMs?: number; intent?: "read" | "write" }
  | { action: "read"; terminalId: string; afterCursor?: number; yieldMs?: number }
  | { action: "write"; terminalId: string; input: string }
  | { action: "stop"; terminalId: string }
  | { action: "list"; projectId?: string };
