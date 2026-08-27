export type McpTool = { name: string; description?: string; inputSchema?: Record<string, unknown> };
export type McpServerInput = {
  id?: string;
  name: string;
  identifier: string;
  transport: "http" | "stdio";
  configuration: {
    url?: string;
    headers?: Record<string, string>;
    command?: string;
    args?: string[];
    cwd?: string;
    env?: Record<string, string>;
  };
  enabled: boolean;
};
export type McpServerRecord = McpServerInput & { id: string; tools: McpTool[]; status: string; lastError?: string | null };
export type SkillRecord = { id: string; name: string; description: string; version: string; sha256: string; size: number; enabled: boolean; installed: boolean };
