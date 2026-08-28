export type McpTool = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpServer = {
  id: string;
  name: string;
  identifier: string;
  transport: "http" | "stdio";
  configuration: {
    url?: string;
    headers?: Record<string, string>;
  };
  enabled?: boolean;
  tools: McpTool[];
};

export type SkillRecord = {
  id: string;
  name: string;
  description: string;
  version: string;
  sha256: string;
  size: number;
  enabled: boolean;
};

export type CapabilitySearchResult = {
  id: string;
  type: "mcp" | "skill";
  name: string;
  score: number;
  matchedTools?: { name: string; score: number }[];
};
