import { callMcpToolByIdentifier, listMcpServers } from "./mcp-manager.js";
import { downloadSkill, listSkills, loadSkillInstructions } from "./skill-manager.js";

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48);

export async function searchCapabilities(query: string): Promise<unknown> {
  const needle = query.trim().toLocaleLowerCase();
  const [servers, skills] = await Promise.all([listMcpServers(), listSkills()]);
  const matches = (value: string): boolean => !needle || value.toLocaleLowerCase().includes(needle);
  const candidates = [
    ...servers.filter((server) => server.enabled)
      .map((server) => ({
        id: `mcp:${server.id}`,
        type: "mcp",
        name: server.name,
        description: `${server.tools.length} tools`,
        matched: matches(`${server.name} ${server.tools.map((tool) => `${tool.name} ${tool.description ?? ""}`).join(" ")}`),
      })),
    ...skills.filter((skill) => skill.enabled)
      .map((skill) => ({
        id: `skill:${skill.name}`,
        type: "skill",
        name: skill.name,
        description: skill.description,
        installed: skill.installed,
        matched: matches(`${skill.name} ${skill.description}`),
      })),
  ];
  return {
    results: candidates.sort((left, right) => Number(right.matched) - Number(left.matched))
      .slice(0, 20)
      .map(({ matched, ...item }) => {
        void matched;
        return item;
      }),
  };
}

export async function loadCapability(id: string): Promise<unknown> {
  if (id.startsWith("skill:")) {
    const name = id.slice(6);
    const skill = (await listSkills()).find((item) => item.name === name && item.enabled);
    if (!skill) throw new Error("skill_not_found");
    if (!skill.installed) await downloadSkill(skill.id);
    return { id, type: "skill", name, instructions: await loadSkillInstructions(name) };
  }
  if (id.startsWith("mcp:")) {
    const serverId = id.slice(4);
    const server = (await listMcpServers()).find((item) => item.id === serverId && item.enabled);
    if (!server) throw new Error("mcp_server_not_found");
    return {
      id,
      type: "mcp",
      name: server.name,
      tools: server.tools.map((tool) => ({
        type: "function",
        function: {
          name: `mcp__${safeName(server.identifier)}__${safeName(tool.name)}`,
          description: tool.description || `${server.name}: ${tool.name}`,
          parameters: tool.inputSchema || { type: "object", properties: {} },
        },
      })),
    };
  }
  throw new Error("capability_not_found");
}

export async function executeMcpCapability(tool: string, args: Record<string, unknown>): Promise<unknown> {
  const match = /^mcp__([a-zA-Z0-9_-]+)__(.+)$/.exec(tool);
  if (!match) throw new Error("invalid_mcp_tool");
  const server = (await listMcpServers()).find((item) => item.identifier === match[1] && item.enabled);
  const original = server?.tools.find((item) => safeName(item.name) === match[2])?.name;
  if (!original) throw new Error("mcp_tool_not_found");
  return callMcpToolByIdentifier(match[1], original, args);
}
