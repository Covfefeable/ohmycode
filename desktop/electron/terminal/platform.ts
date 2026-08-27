export type ShellLaunch = { executable: string; args: string[] };

export function shellLaunch(command: string): ShellLaunch {
  if (process.platform === "win32") {
    return {
      executable: process.env.OHMYCODE_WINDOWS_SHELL || "powershell.exe",
      args: ["-NoLogo", "-NoProfile", "-Command", command],
    };
  }
  return {
    executable: process.env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash"),
    args: ["-l", "-c", command],
  };
}
