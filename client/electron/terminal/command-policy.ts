const commandsRequiringApproval = [
  /\brm\s+-[^\r\n]*r[^\r\n]*f\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bgit\s+clean\s+-[^\r\n]*f/i,
  /\bRemove-Item\b[^\r\n]*-Recurse/i,
  /\b(shutdown|reboot)\b/i,
  /(^|[;&|]\s*)format(?:\.com)?\s+[a-z]:/i,
];

export function commandRequiresApproval(command: string): boolean {
  return commandsRequiringApproval.some((pattern) => pattern.test(command));
}
