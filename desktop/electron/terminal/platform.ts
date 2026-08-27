import { constants, accessSync } from "node:fs";

export type ShellLaunch = { executable: string; args: string[] };

function executable(value: string): boolean {
  try {
    accessSync(value, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function unixShell(): string {
  const configured = process.env.SHELL;
  const fallbacks = process.platform === "darwin"
    ? ["/bin/zsh", "/bin/bash", "/bin/sh"]
    : ["/bin/bash", "/bin/sh"];
  return [configured, ...fallbacks].find((candidate): candidate is string =>
    Boolean(candidate && executable(candidate))) ?? "/bin/sh";
}

export function shellLaunch(command: string): ShellLaunch {
  if (process.platform === "win32") {
    return {
      executable: process.env.OHMYCODE_WINDOWS_SHELL || "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-Command", command],
    };
  }
  return {
    executable: unixShell(),
    args: ["-l", "-c", command],
  };
}
